import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

const HOURLY = 3600_000;
const IDLE_WINDOW = 20 * 60_000; // no sends in 20 min → orphaned, safe to finalize
const SEND_RETENTION_DAYS = 90;

/**
 * Maintenance jobs (§ M5). In-process timers for now; move to the BullMQ
 * `maintenance` queue when Redis lands. Note: monthly `sends` partitioning is
 * a prod-deploy concern (native SQL, not Prisma) — documented in README.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Maintenance");
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), HOURLY);
    // first pass shortly after boot
    setTimeout(() => void this.run(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    try {
      await this.refreshSegmentCounts();
      await this.finalizeStuckCampaigns();
      await this.pruneOldSends();
    } catch (e: any) {
      this.logger.error(`maintenance run failed: ${e.message}`);
    }
  }

  /** Keep segments.cached_count fresh for the dashboard. */
  private async refreshSegmentCounts() {
    const segments = await this.prisma.system.segment.findMany({
      where: { isDynamic: true },
      select: { id: true, tenantId: true, propertyId: true, criteria: true },
    });
    const { segmentAudienceWhere } = await import("../modules/segments/segment-compiler");
    let refreshed = 0;
    for (const s of segments) {
      try {
        const db = this.prisma.forTenant(s.tenantId);
        const where = segmentAudienceWhere(s.criteria as any);
        const count = await db.subscriber.count({
          where: { ...where, propertyId: s.propertyId, status: "active" },
        });
        await db.segment.update({
          where: { id: s.id },
          data: { cachedCount: count, cachedAt: new Date() },
        });
        refreshed++;
      } catch {
        /* bad criteria — skip */
      }
    }
    if (refreshed) this.logger.log(`segment counts refreshed: ${refreshed}`);
  }

  /**
   * Genuinely-orphaned campaigns (process died mid-blast and didn't resume).
   * A campaign is only "stuck" if it has been sending for >1h AND has produced
   * NO send activity in the last IDLE_WINDOW — a live blast (even paced to
   * 1/min, or one resumed after a restart) keeps writing sends, so it is never
   * finalized out from under the runner. Preserves already-recorded counters
   * instead of recomputing (recompute could clobber a live increment).
   */
  private async finalizeStuckCampaigns() {
    const oneHourAgo = new Date(Date.now() - HOURLY);
    const idleSince = new Date(Date.now() - IDLE_WINDOW);
    const candidates = await this.prisma.system.campaign.findMany({
      where: { status: "sending", startedAt: { lt: oneHourAgo } },
      select: { id: true, tenantId: true },
    });
    for (const c of candidates) {
      const db = this.prisma.forTenant(c.tenantId);
      const recentActivity = await db.send.count({
        where: { campaignId: c.id, sentAt: { gte: idleSince } },
      });
      if (recentActivity > 0) continue; // still actively delivering — leave it

      const counts = await db.send.groupBy({
        by: ["status"],
        where: { campaignId: c.id },
        _count: { status: true },
      });
      const map = new Map(counts.map((x) => [x.status, x._count.status]));
      const sent = map.get("sent") ?? 0;
      const queued = map.get("queued") ?? 0;
      await db.campaign.update({
        where: { id: c.id },
        data: {
          status: queued > 0 ? "failed" : "sent",
          finishedAt: new Date(),
          totalSent: sent,
          totalDelivered: sent,
          totalFailed: (map.get("failed") ?? 0) + queued,
          totalExpiredPruned: map.get("expired") ?? 0,
        },
      });
      this.logger.warn(`finalized orphaned campaign ${c.id} (idle >${IDLE_WINDOW / 60000}m)`);
    }
  }

  /** Retention: hard-delete send rows older than SEND_RETENTION_DAYS. */
  private async pruneOldSends() {
    const cutoff = new Date(Date.now() - SEND_RETENTION_DAYS * 86400_000);
    const { count } = await this.prisma.system.send.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`pruned ${count} sends older than ${SEND_RETENTION_DAYS}d`);
  }
}
