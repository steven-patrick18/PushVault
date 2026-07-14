import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser } from "../../common/auth.guard";

/**
 * Google Ads integration:
 *  - tenant-level API credentials (Settings → Integrations)
 *  - "Google norms" compliance check of a property's landing page against
 *    Google Ads destination requirements (automated heuristics)
 *  - create real Search campaigns (created PAUSED for safety) + list them
 *
 * REST API, no SDK: one OAuth refresh + googleAds:mutate with temp resource
 * ids builds budget → campaign → ad group → RSA → keywords in one call.
 */

export type GoogleAdsConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // digits only, dashes stripped
  loginCustomerId?: string; // MCC, optional
  apiVersion?: string; // default v19
};

const MASK = "••••••••";

function mask(v?: string | null): string | null {
  if (!v) return null;
  return v.length <= 8 ? MASK : v.slice(0, 4) + MASK + v.slice(-4);
}

function digits(v: string): string {
  return String(v ?? "").replace(/[^\d]/g, "");
}

@Injectable()
export class GoogleAdsService {
  constructor(private readonly prisma: PrismaService) {}

  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }

  private async rawConfig(user: AuthUser): Promise<GoogleAdsConfig | null> {
    const tenant = await this.db(user).tenant.findUnique({
      where: { id: user.tenantId },
      select: { integrations: true },
    });
    const cfg = (tenant?.integrations as any)?.google_ads;
    return cfg?.developerToken ? (cfg as GoogleAdsConfig) : null;
  }

  /** Masked view for the Settings UI — secrets never leave the server. */
  async getConfig(user: AuthUser) {
    const cfg = await this.rawConfig(user);
    return {
      connected: Boolean(cfg),
      developerToken: mask(cfg?.developerToken),
      clientId: cfg?.clientId ?? null, // client id is not a secret
      clientSecret: mask(cfg?.clientSecret),
      refreshToken: mask(cfg?.refreshToken),
      customerId: cfg?.customerId ?? null,
      loginCustomerId: cfg?.loginCustomerId ?? null,
      apiVersion: cfg?.apiVersion ?? "v19",
    };
  }

  async setConfig(user: AuthUser, input: Partial<GoogleAdsConfig>) {
    const existing = (await this.rawConfig(user)) ?? ({} as GoogleAdsConfig);
    // masked values round-tripped from the UI mean "keep what's stored"
    const keep = (v: string | undefined, old: string | undefined) =>
      !v || v.includes("••") ? old : v.trim();
    const next: GoogleAdsConfig = {
      developerToken: keep(input.developerToken, existing.developerToken) ?? "",
      clientId: keep(input.clientId, existing.clientId) ?? "",
      clientSecret: keep(input.clientSecret, existing.clientSecret) ?? "",
      refreshToken: keep(input.refreshToken, existing.refreshToken) ?? "",
      customerId: digits(keep(input.customerId, existing.customerId) ?? ""),
      loginCustomerId: digits(keep(input.loginCustomerId, existing.loginCustomerId) ?? "") || undefined,
      apiVersion: (input.apiVersion ?? existing.apiVersion ?? "v19").trim(),
    };
    const missing = ["developerToken", "clientId", "clientSecret", "refreshToken", "customerId"]
      .filter((k) => !(next as any)[k]);
    if (missing.length) {
      throw new BadRequestException(`Missing: ${missing.join(", ")}`);
    }
    const tenant = await this.db(user).tenant.findUnique({
      where: { id: user.tenantId },
      select: { integrations: true },
    });
    await this.db(user).tenant.update({
      where: { id: user.tenantId },
      data: {
        integrations: { ...((tenant?.integrations as any) ?? {}), google_ads: next } as any,
      },
    });
    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "integration.google_ads.update",
        entityType: "tenant",
        entityId: user.tenantId,
        after: { customerId: next.customerId } as any,
      },
    });
    return this.getConfig(user);
  }

  async disconnect(user: AuthUser) {
    const tenant = await this.db(user).tenant.findUnique({
      where: { id: user.tenantId },
      select: { integrations: true },
    });
    const integrations = { ...((tenant?.integrations as any) ?? {}) };
    delete integrations.google_ads;
    await this.db(user).tenant.update({
      where: { id: user.tenantId },
      data: { integrations: integrations as any },
    });
    return { connected: false };
  }

  // ---------------------------------------------------------------- OAuth

  private async accessToken(cfg: GoogleAdsConfig): Promise<string> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      throw new BadRequestException(
        `Google OAuth failed: ${json.error_description ?? json.error ?? res.status}. Check client id/secret/refresh token in Settings.`,
      );
    }
    return json.access_token as string;
  }

  private async gadsFetch(cfg: GoogleAdsConfig, path: string, body: unknown) {
    const token = await this.accessToken(cfg);
    const version = cfg.apiVersion ?? "v19";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": cfg.developerToken,
      "Content-Type": "application/json",
    };
    if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;
    const res = await fetch(`https://googleads.googleapis.com/${version}/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        json?.error?.details?.[0]?.errors?.[0]?.message ??
        json?.[0]?.error?.details?.[0]?.errors?.[0]?.message ??
        json?.error?.message ??
        `HTTP ${res.status}`;
      throw new BadRequestException(`Google Ads API: ${detail}`);
    }
    return json;
  }

  // ------------------------------------------------- compliance check

  /**
   * Automated "Google norms" review of the property's landing page against
   * Google Ads destination requirements: working HTTPS destination, no parked
   * page, privacy policy + contact info, mobile viewport, honest content.
   * Verdict: ready / fix-needed. Stored on the property so the team sees the
   * last result.
   */
  async complianceCheck(user: AuthUser, propertyId: string) {
    const property = await this.db(user).property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException("Property not found");
    const domain = property.domains[0];
    if (!domain) throw new BadRequestException("Property has no domain");

    type Check = { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string };
    const checks: Check[] = [];
    const add = (id: string, label: string, status: Check["status"], detail: string) =>
      checks.push({ id, label, status, detail });

    let html = "";
    let finalUrl = "";
    let loadMs = 0;
    let httpsOk = false;
    try {
      const started = Date.now();
      const res = await fetch(`https://${domain}/`, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PushVault-AdsCheck/1.0)" },
        signal: AbortSignal.timeout(20_000),
      });
      loadMs = Date.now() - started;
      finalUrl = res.url || `https://${domain}/`;
      httpsOk = finalUrl.startsWith("https://");
      html = res.ok ? await res.text() : "";
      if (res.ok) {
        add("reachable", "Site loads (working destination)", "pass", `HTTP ${res.status} in ${loadMs}ms`);
      } else {
        add("reachable", "Site loads (working destination)", "fail", `HTTP ${res.status} — Google disapproves ads pointing to error pages`);
      }
    } catch (e: any) {
      add("reachable", "Site loads (working destination)", "fail", `Could not load https://${domain}/ — ${e?.code ?? e?.name ?? "network error"}`);
    }

    if (html) {
      const lower = html.toLowerCase();
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ");

      add("https", "HTTPS (secure destination)", httpsOk ? "pass" : "fail",
        httpsOk ? `Serves over ${new URL(finalUrl).protocol}//` : "Final URL is not HTTPS — required for good ad rank");

      const sameSite = (() => {
        try {
          const h = new URL(finalUrl).hostname.replace(/^www\./, "");
          return h.endsWith(domain.replace(/^www\./, "").split(".").slice(-2).join("."));
        } catch { return true; }
      })();
      add("destination-match", "No redirect to a different domain", sameSite ? "pass" : "fail",
        sameSite ? "Lands on your own domain" : `Redirects to ${finalUrl} — destination mismatch is a policy violation`);

      const title = /<title[^>]*>([^<]{2,})<\/title>/i.exec(html)?.[1]?.trim();
      add("title", "Page has a clear title", title ? "pass" : "warn", title ? `"${title.slice(0, 80)}"` : "Missing <title> — hurts quality score");

      const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
      add("mobile", "Mobile friendly (viewport meta)", viewport ? "pass" : "warn",
        viewport ? "Viewport meta present" : "No viewport meta — most ad clicks are mobile");

      const privacy = /privacy(\s|-)?policy|privacy<\/a>|\/privacy/i.test(lower);
      add("privacy", "Privacy policy present", privacy ? "pass" : "fail",
        privacy ? "Privacy policy link found" : "No privacy policy found — required when collecting any user data (forms, push, analytics)");

      const contact = /tel:|mailto:|contact(\s|-)?us|contact<\/a>|\/contact/i.test(lower);
      add("contact", "Contact information present", contact ? "pass" : "warn",
        contact ? "Contact info/link found" : "No visible contact info — Google favors verifiable businesses");

      const parked = /under construction|coming soon|domain (is )?parked|buy this domain|default web page|website (is )?being built/i.test(text);
      add("parked", "Not a parked / under-construction page", parked ? "fail" : "pass",
        parked ? "Page looks parked or unfinished — ads will be disapproved" : "Real content detected");

      const words = text.split(/\s+/).filter(Boolean).length;
      add("content", "Enough original content", words >= 120 ? "pass" : words >= 40 ? "warn" : "fail",
        `${words} words of visible text${words < 120 ? " — thin content risks 'insufficient original content' disapproval" : ""}`);

      add("speed", "Loads fast", loadMs <= 3000 ? "pass" : loadMs <= 6000 ? "warn" : "fail",
        `${loadMs}ms server response — ${loadMs <= 3000 ? "good" : "slow pages raise CPC and get disapproved at extremes"}`);

      const popups = (lower.match(/window\.open\(/g) ?? []).length;
      add("popups", "No aggressive pop-ups detected", popups <= 1 ? "pass" : "warn",
        popups <= 1 ? "No pop-up patterns found" : `${popups} window.open() calls found — intrusive interstitials violate policy`);
    } else if (checks[0]?.status === "pass") {
      add("content", "Enough original content", "warn", "Page loaded but returned no readable HTML");
    }

    const fails = checks.filter((c) => c.status === "fail").length;
    const warns = checks.filter((c) => c.status === "warn").length;
    const verdict = fails > 0 ? "fix-needed" : warns > 0 ? "ready-with-warnings" : "ready";
    const result = { verdict, fails, warns, checks, url: `https://${domain}/`, at: new Date().toISOString() };

    await this.db(user).property.update({
      where: { id: propertyId },
      data: { adsCheck: result as any },
    });
    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "property.ads_check",
        entityType: "property",
        entityId: propertyId,
        after: { verdict, fails, warns } as any,
      },
    });
    return result;
  }

  // ------------------------------------------------- campaigns

  /**
   * Create a Search campaign (budget → campaign → ad group → responsive
   * search ad → keywords) in ONE mutate call using temp resource ids.
   * Created PAUSED so nothing spends money until it's reviewed and enabled.
   */
  async createCampaign(
    user: AuthUser,
    propertyId: string,
    input: {
      name: string;
      dailyBudget: number; // in account currency units
      finalUrl?: string;
      headlines: string[];
      descriptions: string[];
      keywords: string[];
      cpcBid?: number;
    },
  ) {
    const cfg = await this.rawConfig(user);
    if (!cfg) throw new BadRequestException("Google Ads is not connected — add API credentials in Settings first.");
    const property = await this.db(user).property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException("Property not found");

    const finalUrl = (input.finalUrl?.trim() || `https://${property.domains[0]}/`).replace(/^(?!https?:\/\/)/, "https://");
    const headlines = (input.headlines ?? []).map((h) => h.trim()).filter(Boolean).slice(0, 15);
    const descriptions = (input.descriptions ?? []).map((d) => d.trim()).filter(Boolean).slice(0, 4);
    const keywords = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 50);
    if (headlines.length < 3) throw new BadRequestException("Google requires at least 3 headlines (max 30 chars each)");
    if (descriptions.length < 2) throw new BadRequestException("Google requires at least 2 descriptions (max 90 chars each)");
    if (keywords.length < 1) throw new BadRequestException("Add at least one keyword");
    const tooLongH = headlines.find((h) => h.length > 30);
    if (tooLongH) throw new BadRequestException(`Headline over 30 chars: "${tooLongH}"`);
    const tooLongD = descriptions.find((d) => d.length > 90);
    if (tooLongD) throw new BadRequestException(`Description over 90 chars: "${tooLongD}"`);
    const budgetMicros = Math.round(Math.max(0.5, Number(input.dailyBudget) || 0) * 1_000_000);
    const cpcMicros = Math.round(Math.max(0.05, Number(input.cpcBid) || 1) * 1_000_000);

    const cid = cfg.customerId;
    const name = `${input.name.trim() || property.name} · PushVault`;
    const ops = [
      {
        campaignBudgetOperation: {
          create: {
            resourceName: `customers/${cid}/campaignBudgets/-1`,
            name: `${name} budget`,
            amountMicros: String(budgetMicros),
            deliveryMethod: "STANDARD",
            explicitlyShared: false,
          },
        },
      },
      {
        campaignOperation: {
          create: {
            resourceName: `customers/${cid}/campaigns/-2`,
            name,
            status: "PAUSED",
            advertisingChannelType: "SEARCH",
            manualCpc: {},
            campaignBudget: `customers/${cid}/campaignBudgets/-1`,
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: true,
              targetContentNetwork: false,
            },
          },
        },
      },
      {
        adGroupOperation: {
          create: {
            resourceName: `customers/${cid}/adGroups/-3`,
            name: `${name} · ads`,
            campaign: `customers/${cid}/campaigns/-2`,
            type: "SEARCH_STANDARD",
            status: "ENABLED",
            cpcBidMicros: String(cpcMicros),
          },
        },
      },
      {
        adGroupAdOperation: {
          create: {
            adGroup: `customers/${cid}/adGroups/-3`,
            status: "ENABLED",
            ad: {
              finalUrls: [finalUrl],
              responsiveSearchAd: {
                headlines: headlines.map((text) => ({ text })),
                descriptions: descriptions.map((text) => ({ text })),
              },
            },
          },
        },
      },
      ...keywords.map((text) => ({
        adGroupCriterionOperation: {
          create: {
            adGroup: `customers/${cid}/adGroups/-3`,
            status: "ENABLED",
            keyword: { text, matchType: "PHRASE" },
          },
        },
      })),
    ];

    const json = await this.gadsFetch(cfg, `customers/${cid}/googleAds:mutate`, {
      mutateOperations: ops,
      partialFailure: false,
    });
    const created = (json?.mutateOperationResponses ?? [])
      .map((r: any) => Object.values(r)[0] as any)
      .map((r: any) => r?.resourceName)
      .filter(Boolean);
    const campaignRes = created.find((r: string) => r.includes("/campaigns/"));

    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "google_ads.campaign_create",
        entityType: "property",
        entityId: propertyId,
        after: { name, finalUrl, budgetMicros, campaign: campaignRes } as any,
      },
    });
    return {
      ok: true,
      campaign: campaignRes ?? null,
      created,
      message: "Campaign created PAUSED in Google Ads. Review and enable it there (or ask us to enable it) — it will not spend until enabled.",
    };
  }

  /** List account campaigns with core metrics (last 30 days). */
  async listCampaigns(user: AuthUser) {
    const cfg = await this.rawConfig(user);
    if (!cfg) return { connected: false, campaigns: [] };
    const query = `
      SELECT campaign.id, campaign.name, campaign.status,
             campaign_budget.amount_micros,
             metrics.impressions, metrics.clicks, metrics.cost_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED' AND segments.date DURING LAST_30_DAYS
      ORDER BY campaign.id DESC
      LIMIT 50`;
    const json = await this.gadsFetch(cfg, `customers/${cfg.customerId}/googleAds:search`, { query });
    const campaigns = (json?.results ?? []).map((r: any) => ({
      id: r.campaign?.id,
      name: r.campaign?.name,
      status: r.campaign?.status,
      dailyBudget: Number(r.campaignBudget?.amountMicros ?? 0) / 1_000_000,
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      cost: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
    }));
    return { connected: true, campaigns };
  }
}
