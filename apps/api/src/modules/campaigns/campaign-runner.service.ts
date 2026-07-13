import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService, TenantClient } from "../../infra/prisma.service";
import { RateLimiter, TaskPool, sleep } from "../../queue/task-pool";
import { PushError, PushService } from "./push.service";
import { compileCriteria, SegmentCriteria } from "../segments/segment-compiler";

const BATCH_SIZE = 1000;
const TENANT_CONCURRENCY = 25;
const MAX_RETRIES = 3;

/**
 * The send engine (§7). In-process implementation of the orchestrator +
 * per-tenant send workers; the TaskPool-per-tenant layout mirrors BullMQ's
 * `push-send:{tenantId}` queues so a Redis adapter can slot in later.
 */
@Injectable()
export class CampaignRunnerService implements OnModuleInit {
  private readonly logger = new Logger("CampaignRunner");
  private readonly tenantPools = new Map<string, TaskPool>();
  private readonly scheduledTimers = new Map<string, NodeJS.Timeout>();
  private readonly remaining = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Re-arm scheduled campaigns after a restart. */
  async onModuleInit() {
    const scheduled = await this.prisma.system.campaign.findMany({
      where: { status: "scheduled", scheduleAt: { not: null } },
    });
    for (const c of scheduled) {
      this.armSchedule(c.id, c.scheduleAt!);
      this.logger.log(`Re-armed scheduled campaign ${c.id} for ${c.scheduleAt!.toISOString()}`);
    }
  }

  private pool(tenantId: string): TaskPool {
    let pool = this.tenantPools.get(tenantId);
    if (!pool) {
      pool = new TaskPool(TENANT_CONCURRENCY);
      this.tenantPools.set(tenantId, pool);
    }
    return pool;
  }

  armSchedule(campaignId: string, at: Date) {
    this.cancelSchedule(campaignId);
    const delay = Math.max(at.getTime() - Date.now(), 0);
    const timer = setTimeout(() => {
      this.scheduledTimers.delete(campaignId);
      void this.dispatch(campaignId).catch((e) =>
        this.logger.error(`Scheduled dispatch failed for ${campaignId}: ${e.message}`),
      );
    }, delay);
    this.scheduledTimers.set(campaignId, timer);
  }

  cancelSchedule(campaignId: string) {
    const timer = this.scheduledTimers.get(campaignId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(campaignId);
    }
  }

  /** Orchestrator: `campaign:dispatch` */
  async dispatch(campaignId: string): Promise<void> {
    const campaign = await this.prisma.system.campaign.findUnique({
      where: { id: campaignId },
      include: { segment: true, property: true },
    });
    if (!campaign) throw new Error("Campaign not found");
    if (!["draft", "scheduled"].includes(campaign.status)) {
      throw new Error(`Campaign is ${campaign.status}, cannot dispatch`);
    }

    const db = this.prisma.forTenant(campaign.tenantId);
    await db.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "sending",
        startedAt: new Date(),
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        totalExpiredPruned: 0,
      },
    });

    const segmentWhere = campaign.segment
      ? compileCriteria(campaign.segment.criteria as SegmentCriteria)
      : {};
    const basePayload = {
      title: campaign.title,
      body: campaign.body,
      icon: campaign.iconUrl ?? campaign.property.iconUrl,
      image: campaign.imageUrl,
      url: campaign.clickUrl,
      actions: (campaign.actions as any) ?? undefined,
    };

    // pacing: spread sends evenly instead of blasting at full speed
    const limiter = campaign.pacingPerMinute
      ? new RateLimiter(60_000 / campaign.pacingPerMinute)
      : null;

    const capDay = campaign.property.frequencyCapPerDay;
    const capWeek = campaign.property.frequencyCapPerWeek;
    const dayAgo = new Date(Date.now() - 86400_000);
    const weekAgo = new Date(Date.now() - 7 * 86400_000);

    let cursor: string | undefined;
    let targeted = 0;
    this.remaining.set(campaign.id, Number.MAX_SAFE_INTEGER); // sentinel while streaming

    for (;;) {
      const batch = await db.subscriber.findMany({
        where: { ...segmentWhere, propertyId: campaign.propertyId, status: "active" },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      // Frequency caps (server-side, §7 step 3): sends in the last 24h / 7d
      const ids = batch.map((s) => s.id);
      const [dayCounts, weekCounts] = await Promise.all([
        db.send.groupBy({
          by: ["subscriberId"],
          where: { subscriberId: { in: ids }, status: "sent", sentAt: { gte: dayAgo } },
          _count: { subscriberId: true },
        }),
        db.send.groupBy({
          by: ["subscriberId"],
          where: { subscriberId: { in: ids }, status: "sent", sentAt: { gte: weekAgo } },
          _count: { subscriberId: true },
        }),
      ]);
      const dayMap = new Map(dayCounts.map((c) => [c.subscriberId, c._count.subscriberId]));
      const weekMap = new Map(weekCounts.map((c) => [c.subscriberId, c._count.subscriberId]));
      const eligible = batch.filter(
        (s) => (dayMap.get(s.id) ?? 0) < capDay && (weekMap.get(s.id) ?? 0) < capWeek,
      );
      if (eligible.length === 0) continue;

      // Insert sends (queued) with client-generated ids, then enqueue jobs
      const sendRows = eligible.map((s) => ({
        id: randomUUID(),
        tenantId: campaign.tenantId,
        campaignId: campaign.id,
        subscriberId: s.id,
        status: "queued" as const,
      }));
      await db.send.createMany({ data: sendRows });
      targeted += sendRows.length;

      const pool = this.pool(campaign.tenantId);
      for (let i = 0; i < sendRows.length; i++) {
        const send = sendRows[i];
        const sub = eligible[i];
        pool.add(() =>
          this.processSend(
            db,
            campaign.id,
            campaign.tenantId,
            send.id,
            sub,
            { ...basePayload, send_id: send.id },
            limiter,
          ),
        );
      }
    }

    await db.campaign.update({
      where: { id: campaign.id },
      data: { totalTargeted: targeted },
    });
    this.remaining.set(campaign.id, targeted === 0 ? 0 : targeted - this.consumed(campaign.id));
    if ((this.remaining.get(campaign.id) ?? 0) <= 0) {
      await this.finalize(campaign.id, campaign.tenantId);
    }
    this.logger.log(`Campaign ${campaign.id}: targeted ${targeted}`);
  }

  // completion bookkeeping: processSend decrements via done(); while the
  // orchestrator is still streaming, decrements accumulate in `consumedMap`
  private consumedMap = new Map<string, number>();
  private consumed(campaignId: string) {
    return this.consumedMap.get(campaignId) ?? 0;
  }

  private async done(campaignId: string, tenantId: string) {
    const rem = this.remaining.get(campaignId);
    if (rem === Number.MAX_SAFE_INTEGER) {
      this.consumedMap.set(campaignId, this.consumed(campaignId) + 1);
      return;
    }
    const next = (rem ?? 1) - 1;
    this.remaining.set(campaignId, next);
    if (next <= 0) {
      await this.finalize(campaignId, tenantId);
    }
  }

  private async finalize(campaignId: string, tenantId: string) {
    this.remaining.delete(campaignId);
    this.consumedMap.delete(campaignId);
    const db = this.prisma.forTenant(tenantId);
    const counts = await db.send.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { status: true },
    });
    const map = new Map(counts.map((c) => [c.status, c._count.status]));
    const sent = map.get("sent") ?? 0;
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        status: "sent",
        finishedAt: new Date(),
        totalSent: sent,
        totalDelivered: sent, // v1: delivered = accepted by push service (§8)
        totalFailed: map.get("failed") ?? 0,
        totalExpiredPruned: map.get("expired") ?? 0,
      },
    });
    this.logger.log(`Campaign ${campaignId} finished: ${sent} sent`);
  }

  /** Send worker (§7): one push, with 410 pruning and 429 backoff. */
  private async processSend(
    db: TenantClient,
    campaignId: string,
    tenantId: string,
    sendId: string,
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: any,
    limiter: RateLimiter | null = null,
  ): Promise<void> {
    try {
      if (limiter) await limiter.wait();
      let attempt = 0;
      for (;;) {
        attempt++;
        try {
          await this.push.send(sub, payload);
          break;
        } catch (e) {
          if (e instanceof PushError && e.statusCode === 429 && attempt < MAX_RETRIES) {
            await sleep(1000 * 2 ** (attempt - 1)); // exponential backoff
            continue;
          }
          throw e;
        }
      }
      const now = new Date();
      await db.send.update({
        where: { id: sendId },
        data: { status: "sent", sentAt: now },
      });
      await db.subscriber.update({
        where: { id: sub.id },
        data: { pushesReceived: { increment: 1 }, lastPushAt: now },
      });
      // live progress for the dashboard while the blast is running
      await db.campaign.update({
        where: { id: campaignId },
        data: { totalSent: { increment: 1 }, totalDelivered: { increment: 1 } },
      });
    } catch (e) {
      const code = e instanceof PushError ? e.statusCode : null;
      if (code === 404 || code === 410) {
        // dead token: prune immediately (§7)
        await db.send.update({
          where: { id: sendId },
          data: { status: "expired", errorCode: String(code) },
        });
        await db.subscriber.update({
          where: { id: sub.id },
          data: { status: "expired" },
        });
        await db.campaign.update({
          where: { id: campaignId },
          data: { totalExpiredPruned: { increment: 1 } },
        });
      } else {
        await db.send.update({
          where: { id: sendId },
          data: { status: "failed", errorCode: code ? String(code) : "error" },
        });
        await db.campaign.update({
          where: { id: campaignId },
          data: { totalFailed: { increment: 1 } },
        });
      }
    } finally {
      await this.done(campaignId, tenantId);
    }
  }
}
