import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UAParser } from "ua-parser-js";
import { PrismaService } from "../../infra/prisma.service";
import { GeoService } from "./geo.service";
import { AutomationsService } from "../automations/automations.service";
import { MembershipService } from "../segments/membership.service";

interface SubscribeInput {
  property_key: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  utm?: Partial<Record<"source" | "medium" | "campaign" | "content" | "term", string>>;
  landing_url?: string;
  referrer?: string;
  tz?: string;
  lang?: string;
}

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly automations: AutomationsService,
    private readonly membership: MembershipService,
  ) {}

  /**
   * Resolve property by key and validate the request Origin against its
   * domains. `requireOrigin` (used for state-changing endpoints) rejects a
   * missing Origin outright: the property_key is public (it ships in every
   * page's snippet), so the Origin allowlist is the real access control — and
   * only a real browser sends Origin. A curl/script with no Origin must not be
   * allowed to write with just the public key.
   */
  private async resolveProperty(
    propertyKey: string,
    origin: string | undefined,
    requireOrigin = false,
  ) {
    const property = await this.prisma.system.property.findUnique({
      where: { propertyKey },
    });
    if (!property || property.status !== "active") {
      throw new NotFoundException("Unknown property");
    }
    if (requireOrigin && !origin) {
      throw new ForbiddenException("Missing Origin — requests must come from the property's site");
    }
    if (origin) {
      let host: string;
      let hostname: string;
      try {
        const url = new URL(origin);
        host = url.host;
        hostname = url.hostname;
      } catch {
        throw new ForbiddenException("Invalid Origin");
      }
      const allowed = property.domains.some((d) =>
        d.includes(":") ? d === host : d === hostname,
      );
      if (!allowed) throw new ForbiddenException("Origin not allowed for this property");
    }
    return property;
  }

  // short-lived cache of active properties so Caddy's on-demand-TLS "ask"
  // (one call per unknown SNI) and every hosted-page render don't table-scan
  private hostCache: { at: number; rows: any[] } | null = null;
  private async activeProperties() {
    const now = Date.now();
    if (!this.hostCache || now - this.hostCache.at > 30_000) {
      const rows = await this.prisma.system.property.findMany({ where: { status: "active" } });
      this.hostCache = { at: now, rows };
    }
    return this.hostCache.rows;
  }

  /** Find a property by one of its registered domains (bare host match). */
  async propertyByHost(host: string | undefined) {
    if (!host) return null;
    const bare = host.toLowerCase().split(":")[0].replace(/\.$/, ""); // drop port + trailing dot
    const all = await this.activeProperties();
    return (
      all.find(
        (p: any) =>
          p.domains.some((d: string) => d === host || d === bare) ||
          // the branded click-to-call bridge host also needs a cert issued
          (p.callDomain && (p.callDomain === host || p.callDomain === bare)),
      ) ?? null
    );
  }

  async getPromptConfig(propertyKey: string, origin: string | undefined, ip?: string) {
    const property = await this.resolveProperty(propertyKey, origin);
    // resolve the visitor's country for audience targeting (null if no GeoIP DB)
    let visitorCountry: string | null = null;
    let visitorDatacenter = false;
    try {
      visitorCountry = this.geo.lookup(ip)?.country ?? null;
      // spoof-proof bot signal: is this IP on a datacenter/cloud/VPN network?
      visitorDatacenter = this.geo.isDatacenter(ip);
    } catch {
      visitorCountry = null;
      visitorDatacenter = false;
    }
    return {
      prompt_config: property.promptConfig,
      icon_url: property.iconUrl,
      vapid_public_key: property.vapidPublic ?? process.env.VAPID_PUBLIC_KEY,
      visitor_country: visitorCountry,
      visitor_datacenter: visitorDatacenter,
    };
  }

  async subscribe(input: SubscribeInput, origin: string | undefined, ip: string | undefined, userAgent: string | undefined) {
    const property = await this.resolveProperty(input.property_key, origin, true);
    const { endpoint, keys } = input.subscription ?? ({} as any);
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new BadRequestException("Invalid push subscription");
    }
    if (!isValidPushEndpoint(endpoint)) {
      throw new BadRequestException("Invalid push endpoint");
    }

    const ua = new UAParser(userAgent ?? "");
    const deviceType = ua.getDevice().type;
    const device =
      deviceType === "mobile" ? "mobile" : deviceType === "tablet" ? "tablet" : "desktop";
    const geo = this.geo.lookup(ip);

    const db = this.prisma.forTenant(property.tenantId);
    const attribution = {
      utmSource: input.utm?.source ?? null,
      utmMedium: input.utm?.medium ?? null,
      utmCampaign: input.utm?.campaign ?? null,
      utmContent: input.utm?.content ?? null,
      utmTerm: input.utm?.term ?? null,
      landingUrl: input.landing_url ?? null,
      referrer: input.referrer ?? null,
    };

    const existing = await db.subscriber.findUnique({
      where: { propertyId_endpoint: { propertyId: property.id, endpoint } },
      select: { id: true },
    });

    const subscriber = await db.subscriber.upsert({
      where: {
        propertyId_endpoint: { propertyId: property.id, endpoint },
      },
      create: {
        tenantId: property.tenantId,
        propertyId: property.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        status: "active",
        ...attribution,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        device: device as any,
        browser: ua.getBrowser().name ?? null,
        os: ua.getOS().name ?? null,
        language: input.lang ?? null,
        timezone: input.tz ?? null,
      },
      update: {
        // re-subscribe / reactivate: refresh keys, keep original attribution
        p256dh: keys.p256dh,
        auth: keys.auth,
        status: "active",
        unsubscribedAt: null,
      },
    });

    // new subscriber → kick off drip automations + auto-assign distribution
    if (!existing) {
      void this.automations
        .enqueueForSubscriber(property.tenantId, property.id, subscriber.id)
        .catch(() => undefined);
      void this.membership
        .autoAssignNewLead(property.tenantId, property.id, subscriber.id)
        .catch(() => undefined);
    }

    return { subscriber_id: subscriber.id };
  }

  async unsubscribe(propertyKey: string, endpoint: string, origin: string | undefined) {
    const property = await this.resolveProperty(propertyKey, origin, true);
    const db = this.prisma.forTenant(property.tenantId);
    const sub = await db.subscriber.findUnique({
      where: { propertyId_endpoint: { propertyId: property.id, endpoint } },
      select: { id: true },
    });
    await db.subscriber.updateMany({
      where: { propertyId: property.id, endpoint },
      data: { status: "unsubscribed", unsubscribedAt: new Date() },
    });
    if (sub) {
      void this.automations.cancelForSubscriber(property.tenantId, sub.id).catch(() => undefined);
    }
    return { ok: true };
  }

  /** Revenue attribution: reported by the pixel (snippet) or the webhook. */
  async trackConversion(
    input: {
      property_key?: string;
      propertyId?: string;
      tenantId?: string;
      send_id?: string;
      amount: number;
      currency?: string;
      order_id?: string;
      source: "pixel" | "webhook";
    },
    origin?: string,
  ) {
    let tenantId = input.tenantId;
    let propertyId = input.propertyId;
    if (!tenantId || !propertyId) {
      // pixel conversions come from the browser (require Origin); webhook
      // conversions are pre-authenticated by X-Api-Key and pass tenantId
      const property = await this.resolveProperty(
        input.property_key!,
        origin,
        input.source === "pixel",
      );
      tenantId = property.tenantId;
      propertyId = property.id;
    }
    if (!(input.amount > 0)) throw new BadRequestException("amount must be > 0");

    const db = this.prisma.forTenant(tenantId);
    let subscriberId: string | null = null;
    let campaignId: string | null = null;
    let sendId: string | null = null;
    if (input.send_id) {
      const send = await db.send.findUnique({ where: { id: input.send_id } });
      if (send) {
        sendId = send.id;
        subscriberId = send.subscriberId;
        campaignId = send.campaignId;
      }
    }

    const conversion = await db.conversion.create({
      data: {
        tenantId,
        propertyId,
        subscriberId,
        sendId,
        campaignId,
        orderId: input.order_id ?? null,
        amount: input.amount,
        currency: (input.currency ?? "INR").toUpperCase().slice(0, 3),
        source: input.source,
      },
    });
    return { ok: true, conversion_id: conversion.id, attributed: Boolean(sendId) };
  }

  /** Page discovery: the snippet beacons each page it loads on. */
  async trackPageview(propertyKey: string, path: string, origin: string | undefined) {
    const property = await this.resolveProperty(propertyKey, origin, true);
    const cleanPath = path.slice(0, 500).split("?")[0] || "/";
    const db = this.prisma.forTenant(property.tenantId);
    const existing = await db.pagePath.findUnique({
      where: { propertyId_path: { propertyId: property.id, path: cleanPath } },
      select: { id: true },
    });
    if (existing) {
      await db.pagePath.update({
        where: { id: existing.id },
        data: { views: { increment: 1 }, lastSeenAt: new Date() },
      });
      return { ok: true };
    }
    // cap distinct paths per property so pageview spam can't grow the table
    // unbounded; real sites have far fewer than this many unique pages
    const PAGE_CAP = 2000;
    const count = await db.pagePath.count({ where: { propertyId: property.id } });
    if (count >= PAGE_CAP) return { ok: true, capped: true };
    await db.pagePath.create({
      data: { tenantId: property.tenantId, propertyId: property.id, path: cleanPath },
    });
    return { ok: true };
  }

  /**
   * The call bridge must only dial numbers a tenant actually configured, never
   * an arbitrary number an attacker puts in the URL (toll fraud). We resolve
   * the referenced send → its campaign → and confirm the requested number is
   * one of that campaign's registered call numbers.
   */
  async callNumberAllowed(sanitizedNumber: string, clickId: string | undefined): Promise<boolean> {
    if (!sanitizedNumber || !clickId) return false;
    if (!/^[0-9a-f-]{36}$/i.test(clickId)) return false; // must be a real send UUID
    const send = await this.prisma.system.send.findUnique({
      where: { id: clickId },
      select: { campaignId: true },
    });
    if (!send?.campaignId) return false;
    const campaign = await this.prisma.system.campaign.findUnique({
      where: { id: send.campaignId },
      select: { callNumbers: true },
    });
    if (!campaign) return false;
    const norm = (s: string) => String(s).replace(/[^\d+]/g, "");
    return (campaign.callNumbers ?? []).some((c) => norm(c) === sanitizedNumber);
  }

  /** Idempotent click tracking, called by the service worker. */
  async trackClick(sendId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(sendId)) throw new NotFoundException("Unknown send");
    const send = await this.prisma.system.send.findUnique({ where: { id: sendId } });
    if (!send) throw new NotFoundException("Unknown send");
    if (send.clicked) return { ok: true, already: true };

    const db = this.prisma.forTenant(send.tenantId);
    const now = new Date();
    // atomic flip: only the FIRST click (clicked=false) wins the row, so
    // two near-simultaneous taps can't both pass the guard and double-count
    const claimed = await db.send.updateMany({
      where: { id: send.id, clicked: false },
      data: { clicked: true, clickedAt: now },
    });
    if (claimed.count === 0) return { ok: true, already: true };

    await db.subscriber.update({
      where: { id: send.subscriberId },
      data: { pushesClicked: { increment: 1 }, lastClickAt: now },
    });
    if (send.campaignId) {
      await db.campaign.update({
        where: { id: send.campaignId },
        data: { totalClicked: { increment: 1 } },
      });
    }
    return { ok: true };
  }
}

/**
 * A push subscription endpoint must be an https URL on a real push service.
 * Rejecting anything else stops table-flooding with junk endpoints and closes
 * an SSRF vector (the endpoint is later POSTed to by the sender) — an attacker
 * can't register `http://169.254.169.254/…` or `http://api:3000/…` as a "lead".
 */
export function isValidPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  // block obvious internal targets outright
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) || // raw IPv4 (push services use hostnames)
    host.includes(":") // raw IPv6
  ) {
    return false;
  }
  // known web-push hosts (FCM/Chrome, Mozilla, Apple, Windows/WNS, Edge)
  const allow = [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "notify.windows.com",
    "wns2-",
    ".notify.windows.com",
    "push.apple.com",
  ];
  return allow.some((h) => host === h || host.endsWith(h) || host.includes(h));
}
