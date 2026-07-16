import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { generateKey, hashApiKey } from "../../common/crypto";
import { assertPropertyAccess, AuthUser } from "../../common/auth.guard";
import * as webpush from "web-push";
import { resolve4 } from "node:dns/promises";

const DEFAULT_PROMPT_CONFIG = {
  trigger: { type: "delay", seconds: 12 },
  pages: { include: ["*"], exclude: [] },
  text: {
    headline: "🔔 Get offers & price-drop alerts?",
    yes: "Yes, notify me",
    no: "No thanks",
  },
  style: { position: "top", accent: "#7C3AED", logo: null },
  reask: { enabled: false, cooldown_days: 7 },
};

/**
 * Origin validation and verification compare against a bare host
 * (`example.com` or `example.com:8443`). Users naturally paste
 * `https://example.com/` — strip the scheme, path, trailing slash, and
 * lowercase so those inputs still match. Drops `www.` duplicates handled
 * by the caller keeping both if they were entered separately.
 */
export function normalizeDomain(input: string): string {
  let d = (input ?? "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, ""); // scheme
  d = d.replace(/\/.*$/, ""); // path / trailing slash
  d = d.replace(/^\*+\.?/, ""); // stray wildcards
  return d;
}

function normalizeDomains(domains: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of domains ?? []) {
    const d = normalizeDomain(raw);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }

  async list(user: AuthUser) {
    const properties = await this.db(user).property.findMany({
      where: user.role === "client" ? { id: { in: user.propertyIds } } : undefined,
      orderBy: { createdAt: "asc" },
    });
    return properties.map((p) => this.serialize(p));
  }

  async get(user: AuthUser, id: string) {
    assertPropertyAccess(user, id);
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    return { ...this.serialize(property), install: this.installSnippet(property.propertyKey) };
  }

  async create(user: AuthUser, data: { name: string; domains: string[]; iconUrl?: string }) {
    const propertyKey = generateKey("pk_live");
    const apiKey = generateKey("sk_live");
    const domains = normalizeDomains(data.domains);
    if (domains.length === 0) {
      throw new BadRequestException("At least one valid domain is required");
    }
    const property = await this.db(user).property.create({
      data: {
        tenantId: user.tenantId,
        name: data.name,
        domains,
        iconUrl: data.iconUrl ?? null,
        propertyKey,
        promptConfig: DEFAULT_PROMPT_CONFIG,
        apiKeyHash: hashApiKey(apiKey),
      },
    });
    await this.audit(user, "property.create", property.id, null, { name: data.name });
    return {
      ...this.serialize(property),
      apiKey, // shown once
      install: this.installSnippet(propertyKey),
    };
  }

  async update(
    user: AuthUser,
    id: string,
    data: Partial<{
      name: string;
      domains: string[];
      iconUrl: string | null;
      promptConfig: unknown;
      callDomain: string | null;
      frequencyCapPerDay: number;
      frequencyCapPerWeek: number;
      status: string;
    }>,
  ) {
    const before = await this.db(user).property.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Property not found");
    const patch: any = { ...data };
    if (data.domains) {
      patch.domains = normalizeDomains(data.domains);
      if (patch.domains.length === 0) {
        throw new BadRequestException("At least one valid domain is required");
      }
    }
    if (data.callDomain !== undefined) {
      // normalize like a domain (strip scheme/path); empty clears it
      const d = data.callDomain ? normalizeDomain(data.callDomain) : "";
      patch.callDomain = d || null;
    }
    const property = await this.db(user).property.update({
      where: { id },
      data: patch,
    });
    await this.audit(user, "property.update", id, { name: before.name }, data);
    return this.serialize(property);
  }

  /**
   * Self-serve hosted opt-in activation. Checks the subdomain's DNS points at
   * this server; if so, adds it to the property's domains (which is what the
   * TLS gate, host resolution and Origin validation all check) and warms the
   * HTTPS certificate with a first request. Admins and managers can run it —
   * one button in the dashboard instead of an ops task.
   */
  async activateHostedDomain(user: AuthUser, id: string, rawDomain: string) {
    const domain = normalizeDomain(rawDomain);
    if (!domain || !domain.includes(".") || /[^a-z0-9.-]/.test(domain)) {
      throw new BadRequestException("Enter a full subdomain, e.g. alerts.yourdomain.com");
    }
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");

    // where the DNS A record should point: explicit env, else wherever the
    // dashboard domain itself resolves (same server)
    let expectedIps: string[] = [];
    if (process.env.SERVER_PUBLIC_IP) {
      expectedIps = [process.env.SERVER_PUBLIC_IP.trim()];
    } else if (process.env.PUSH_DOMAIN) {
      try {
        expectedIps = await resolve4(process.env.PUSH_DOMAIN);
      } catch {
        expectedIps = [];
      }
    }

    let resolvedIps: string[] = [];
    let dnsStatus: "ok" | "wrong-ip" | "not-found" = "not-found";
    try {
      resolvedIps = await resolve4(domain);
      dnsStatus =
        expectedIps.length === 0 || resolvedIps.some((ip) => expectedIps.includes(ip))
          ? "ok"
          : "wrong-ip";
    } catch {
      dnsStatus = "not-found";
    }

    const alreadyAdded = property.domains.includes(domain);
    if (dnsStatus === "ok" && !alreadyAdded) {
      await this.db(user).property.update({
        where: { id },
        data: { domains: [...property.domains, domain] },
      });
      await this.audit(user, "property.hosted_domain", id, null, { domain });
    }

    // warm the certificate: the first HTTPS request makes Caddy issue it
    // on demand, so the first visitor never waits on ACME
    let certificate: "issued" | "pending" = "pending";
    if (dnsStatus === "ok") {
      try {
        const r = await fetch(`https://${domain}/`, {
          signal: AbortSignal.timeout(20_000),
          redirect: "manual",
        });
        if (r.status > 0) certificate = "issued";
      } catch {
        certificate = "pending";
      }
    }

    return {
      domain,
      url: `https://${domain}/`,
      dnsStatus,
      resolvedIps,
      expectedIps,
      active: dnsStatus === "ok",
      certificate,
      message:
        dnsStatus === "ok"
          ? certificate === "issued"
            ? "Live! The hosted opt-in page is active with HTTPS."
            : "DNS is pointed and the domain is registered — HTTPS finishes on the first visit (usually seconds)."
          : dnsStatus === "wrong-ip"
            ? `DNS points to ${resolvedIps.join(", ")} but should point to ${expectedIps.join(", ")}. Fix the A record and try again.`
            : "DNS record not found yet. Add the A record, wait a few minutes for propagation, then press Activate again.",
    };
  }

  /** Delete a property. Refuses if it still has subscribers or campaigns. */
  async remove(user: AuthUser, id: string) {
    const db = this.db(user);
    const property = await db.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    const [subs, camps] = await Promise.all([
      db.subscriber.count({ where: { propertyId: id } }),
      db.campaign.count({ where: { propertyId: id } }),
    ]);
    if (subs > 0 || camps > 0) {
      throw new BadRequestException(
        `Property has ${subs} subscriber(s) and ${camps} campaign(s) — remove those first (GDPR erase subscribers, delete campaigns).`,
      );
    }
    await db.pagePath.deleteMany({ where: { propertyId: id } });
    await db.segment.deleteMany({ where: { propertyId: id } });
    await db.automation.deleteMany({ where: { propertyId: id } });
    await db.property.delete({ where: { id } });
    await this.audit(user, "property.delete", id, { name: property.name }, null);
    return { ok: true };
  }

  async rotateApiKey(user: AuthUser, id: string) {
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    const apiKey = generateKey("sk_live");
    await this.db(user).property.update({
      where: { id },
      data: { apiKeyHash: hashApiKey(apiKey) },
    });
    await this.audit(user, "property.rotate_api_key", id, null, null);
    return { apiKey }; // shown once
  }

  /**
   * Dedicated VAPID keys for this property (Phase 3 white-label). WARNING:
   * existing subscribers are bound to the previous key pair — generate this
   * BEFORE collecting subscribers, or accept re-subscription of the old base.
   */
  async generateVapid(user: AuthUser, id: string) {
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    const keys = webpush.generateVAPIDKeys();
    await this.db(user).property.update({
      where: { id },
      data: { vapidPublic: keys.publicKey, vapidPrivate: keys.privateKey },
    });
    await this.audit(user, "property.generate_vapid", id, null, null);
    return { vapidPublic: keys.publicKey };
  }

  /**
   * Installation check: for every domain, confirm the client uploaded
   * pv-sw.js to the site root (the "key file" handed to them at creation).
   */
  async verify(user: AuthUser, id: string) {
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");

    const results = await Promise.all(
      property.domains.map(async (domain) => {
        const schemes = domain.startsWith("localhost") ? ["http"] : ["https"];
        for (const scheme of schemes) {
          const url = `${scheme}://${domain}/pv-sw.js`;
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            const body = res.ok ? await res.text() : "";
            const looksRight = body.includes("showNotification");
            if (res.ok) {
              return { domain, url, ok: looksRight, status: res.status, sw: looksRight };
            }
            return { domain, url, ok: false, status: res.status, sw: false };
          } catch {
            /* try next scheme / fall through */
          }
        }
        return { domain, url: null, ok: false, status: null, sw: false };
      }),
    );

    // verified if AT LEAST ONE registered domain serves the service worker —
    // a hosted opt-in subdomain (alerts.example.com) is enough to collect
    // subscribers even when the main domain can't host files
    const anyOk = results.some((r) => r.ok);
    const verification = { checkedAt: new Date().toISOString(), results, anyOk };
    await this.db(user).property.update({
      where: { id },
      data: {
        verification: verification as any,
        verifiedAt: anyOk ? new Date() : null,
      },
    });
    await this.audit(user, "property.verify", id, null, { anyOk });
    return { verified: anyOk, ...verification };
  }

  /** Pages discovered by the snippet beacon, with allow/block state. */
  async pages(user: AuthUser, id: string) {
    assertPropertyAccess(user, id);
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    const pages = await this.db(user).pagePath.findMany({
      where: { propertyId: id },
      orderBy: { views: "desc" },
    });
    const cfg: any = property.promptConfig ?? {};
    const include: string[] = cfg.pages?.include?.length ? cfg.pages.include : ["*"];
    const exclude: string[] = cfg.pages?.exclude ?? [];
    const toRegex = (glob: string) =>
      new RegExp(
        "^" + glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
      );
    return pages.map((p) => ({
      ...p,
      allowed:
        !exclude.some((g) => toRegex(g).test(p.path)) &&
        include.some((g) => g === "*" || toRegex(g).test(p.path)),
    }));
  }

  /** Auto-assign distribution rule for new leads (status + weighted segment list). */
  async getAutoAssign(user: AuthUser, id: string) {
    assertPropertyAccess(user, id);
    const property = await this.db(user).property.findUnique({
      where: { id },
      select: { autoAssign: true },
    });
    if (!property) throw new NotFoundException("Property not found");
    return property.autoAssign ?? { status: "paused", rules: [], counts: {} };
  }

  async setAutoAssign(
    user: AuthUser,
    id: string,
    body: { status: "active" | "paused"; rules: { segmentId: string; weight: number }[] } | null,
  ) {
    const property = await this.db(user).property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException("Property not found");
    if (body !== null) {
      if (!["active", "paused"].includes(body.status)) {
        throw new BadRequestException("status must be active or paused");
      }
      if (!Array.isArray(body.rules) || body.rules.some((r) => !r.segmentId || !(r.weight > 0))) {
        throw new BadRequestException("rules need segmentId and weight > 0");
      }
    }
    const previous = (property.autoAssign as any) ?? {};
    const next =
      body === null
        ? null // stop: remove the rule entirely
        : { status: body.status, rules: body.rules, counts: previous.counts ?? {} };
    await this.db(user).property.update({
      where: { id },
      data: { autoAssign: next as any },
    });
    await this.audit(user, "property.auto_assign", id, previous, next);
    return next ?? { status: "stopped", rules: [], counts: {} };
  }

  private installSnippet(propertyKey: string) {
    const cdn = process.env.CDN_BASE_URL ?? "http://localhost:3000/cdn";
    return {
      script: `<script src="${cdn}/pushvault.js" data-property-key="${propertyKey}" defer></script>`,
      swUrl: `${cdn}/pv-sw.js`, // download source for the service worker
      serverIp: process.env.SERVER_PUBLIC_IP ?? null, // A-record target for hosted opt-in pages
      serviceWorker:
        "Upload pv-sw.js to your site root so it is reachable at https://yourdomain.com/pv-sw.js",
    };
  }

  private serialize(p: any) {
    const { apiKeyHash, vapidPrivate, monthlySendQuota, ...rest } = p;
    return {
      ...rest,
      monthlySendQuota: monthlySendQuota === null ? null : Number(monthlySendQuota),
      hasApiKey: Boolean(apiKeyHash),
    };
  }

  private async audit(
    user: AuthUser,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action,
        entityType: "property",
        entityId,
        before: before as any,
        after: after as any,
      },
    });
  }
}
