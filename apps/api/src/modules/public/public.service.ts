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

  /** Resolve property by key and validate the request Origin against its domains. */
  private async resolveProperty(propertyKey: string, origin: string | undefined) {
    const property = await this.prisma.system.property.findUnique({
      where: { propertyKey },
    });
    if (!property || property.status !== "active") {
      throw new NotFoundException("Unknown property");
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

  /** Find a property by one of its registered domains (bare host match). */
  async propertyByHost(host: string | undefined) {
    if (!host) return null;
    const bare = host.toLowerCase().split(":")[0];
    // exact host match, then bare hostname (drop port) — same rule as origin check
    const all = await this.prisma.system.property.findMany({ where: { status: "active" } });
    return (
      all.find((p) => p.domains.some((d) => d === host || d === bare)) ?? null
    );
  }

  async getPromptConfig(propertyKey: string, origin: string | undefined) {
    const property = await this.resolveProperty(propertyKey, origin);
    return {
      prompt_config: property.promptConfig,
      icon_url: property.iconUrl,
      vapid_public_key: property.vapidPublic ?? process.env.VAPID_PUBLIC_KEY,
    };
  }

  async subscribe(input: SubscribeInput, origin: string | undefined, ip: string | undefined, userAgent: string | undefined) {
    const property = await this.resolveProperty(input.property_key, origin);
    const { endpoint, keys } = input.subscription ?? ({} as any);
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new BadRequestException("Invalid push subscription");
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
    const property = await this.resolveProperty(propertyKey, origin);
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
      const property = await this.resolveProperty(input.property_key!, origin);
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
    const property = await this.resolveProperty(propertyKey, origin);
    const cleanPath = path.slice(0, 500).split("?")[0] || "/";
    const db = this.prisma.forTenant(property.tenantId);
    await db.pagePath.upsert({
      where: { propertyId_path: { propertyId: property.id, path: cleanPath } },
      create: {
        tenantId: property.tenantId,
        propertyId: property.id,
        path: cleanPath,
      },
      update: { views: { increment: 1 }, lastSeenAt: new Date() },
    });
    return { ok: true };
  }

  /** Idempotent click tracking, called by the service worker. */
  async trackClick(sendId: string) {
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
