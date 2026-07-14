import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser } from "../../common/auth.guard";
import { ErrorLogService } from "./error-log.service";

type Check = {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
};

/**
 * Self-serve diagnostics for non-technical operators. Answers "is everything
 * healthy, and if not, what do I do?" without needing SSH or a developer.
 * Every check returns a plain-English detail and, when failing, a fix hint.
 */
@Injectable()
export class TroubleshootService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly errors: ErrorLogService,
  ) {}

  async diagnose(user: AuthUser) {
    const checks: Check[] = [];
    const add = (c: Check) => checks.push(c);
    const db = this.prisma.forTenant(user.tenantId);

    // 1. database
    try {
      await this.prisma.system.$queryRaw`SELECT 1`;
      add({ id: "db", label: "Database connection", status: "ok", detail: "Connected." });
    } catch (e: any) {
      add({
        id: "db",
        label: "Database connection",
        status: "fail",
        detail: `Cannot reach the database: ${e?.message ?? e}`,
        fix: "The database container may be down. On the server run: docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d",
      });
    }

    // 2. properties + push identity
    let properties: any[] = [];
    try {
      properties = await db.property.findMany({
        select: { id: true, name: true, domains: true, vapidPublic: true, verifiedAt: true },
      });
    } catch {
      /* db check already reported */
    }
    const globalVapid = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    if (properties.length === 0) {
      add({ id: "properties", label: "Properties", status: "warn", detail: "No properties yet.", fix: "Add your first website under Properties → New property." });
    } else {
      add({ id: "properties", label: "Properties", status: "ok", detail: `${properties.length} configured.` });
      const noPush = properties.filter((p) => !p.vapidPublic && !globalVapid);
      if (noPush.length) {
        add({
          id: "vapid",
          label: "Push keys (VAPID)",
          status: "fail",
          detail: `${noPush.length} propert(y/ies) have no push keys and no platform keys are set: ${noPush.map((p) => p.name).join(", ")}`,
          fix: "Open each property → Push identity → Generate dedicated keys, or set platform VAPID keys in the server .env.",
        });
      } else {
        add({ id: "vapid", label: "Push keys (VAPID)", status: "ok", detail: globalVapid ? "Platform keys present." : "All properties have dedicated keys." });
      }
      const unverified = properties.filter((p) => !p.verifiedAt);
      if (unverified.length) {
        add({
          id: "verify",
          label: "Install verification",
          status: "warn",
          detail: `${unverified.length} propert(y/ies) not verified: ${unverified.map((p) => p.name).join(", ")}`,
          fix: "Open the property and click Verify installation once the snippet (or hosted page) is live.",
        });
      }
    }

    // 3. subscribers
    try {
      const [total, active] = await Promise.all([
        db.subscriber.count(),
        db.subscriber.count({ where: { status: "active" } }),
      ]);
      add({
        id: "subscribers",
        label: "Subscribers (leads)",
        status: "ok",
        detail: total === 0 ? "No leads yet — share a subscribe link to collect them." : `${total} total, ${active} active.`,
      });
    } catch {
      /* covered by db check */
    }

    // 4. stuck / sending campaigns
    try {
      const sending = await db.campaign.findMany({
        where: { status: "sending" },
        select: { id: true, name: true, updatedAt: true },
      });
      const stale = sending.filter((c) => {
        const t = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
        return t > 0 && Date.now() - t > 60 * 60 * 1000;
      });
      if (stale.length) {
        add({
          id: "campaigns",
          label: "Campaigns",
          status: "warn",
          detail: `${stale.length} campaign(s) have been "sending" for over an hour: ${stale.map((c) => c.name).join(", ")}`,
          fix: "Open the campaign and Pause then Resume it, or Cancel it. The hourly maintenance job also auto-finalizes truly stuck blasts.",
        });
      } else if (sending.length) {
        add({ id: "campaigns", label: "Campaigns", status: "ok", detail: `${sending.length} actively sending.` });
      } else {
        add({ id: "campaigns", label: "Campaigns", status: "ok", detail: "No blasts in progress." });
      }
    } catch {
      /* covered */
    }

    // 5. recent failed sends (last 24h)
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [failed, sent] = await Promise.all([
        db.send.count({ where: { status: "failed", createdAt: { gte: since } } }),
        db.send.count({ where: { status: "sent", createdAt: { gte: since } } }),
      ]);
      const totalTried = failed + sent;
      const rate = totalTried > 0 ? failed / totalTried : 0;
      if (totalTried > 20 && rate > 0.3) {
        add({
          id: "delivery",
          label: "Delivery health (24h)",
          status: "warn",
          detail: `${Math.round(rate * 100)}% of pushes failed (${failed} of ${totalTried}).`,
          fix: "High failure usually means expired subscriptions (normal churn) or a VAPID/key mismatch. Check the error log below; re-generating keys invalidates existing subscribers.",
        });
      } else {
        add({ id: "delivery", label: "Delivery health (24h)", status: "ok", detail: totalTried === 0 ? "No sends in the last 24h." : `${sent} delivered, ${failed} failed.` });
      }
    } catch {
      /* covered */
    }

    const failCount = checks.filter((c) => c.status === "fail").length;
    const warnCount = checks.filter((c) => c.status === "warn").length;
    return {
      overall: failCount ? "problem" : warnCount ? "attention" : "healthy",
      failCount,
      warnCount,
      checks,
      recentErrors: this.errors.recent(30),
      at: new Date().toISOString(),
    };
  }
}
