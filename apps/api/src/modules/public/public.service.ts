import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UAParser } from "ua-parser-js";
import { PrismaService } from "../../infra/prisma.service";
import { GeoService } from "./geo.service";

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

    return { subscriber_id: subscriber.id };
  }

  async unsubscribe(propertyKey: string, endpoint: string, origin: string | undefined) {
    const property = await this.resolveProperty(propertyKey, origin);
    const db = this.prisma.forTenant(property.tenantId);
    await db.subscriber.updateMany({
      where: { propertyId: property.id, endpoint },
      data: { status: "unsubscribed", unsubscribedAt: new Date() },
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
    await db.send.update({
      where: { id: send.id },
      data: { clicked: true, clickedAt: now },
    });
    await db.subscriber.update({
      where: { id: send.subscriberId },
      data: { pushesClicked: { increment: 1 }, lastClickAt: now },
    });
    await db.campaign.update({
      where: { id: send.campaignId },
      data: { totalClicked: { increment: 1 } },
    });
    return { ok: true };
  }
}
