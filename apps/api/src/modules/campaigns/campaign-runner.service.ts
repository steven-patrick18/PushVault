import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService, TenantClient } from "../../infra/prisma.service";
import { RateLimiter, TaskPool, sleep } from "../../queue/task-pool";
import { PushError, PushService, VapidOverride } from "./push.service";
import { segmentAudienceWhere, SegmentCriteria } from "../segments/segment-compiler";
import { isRecurrence, nextOccurrence } from "./recurrence";
import { PLAN_QUOTAS, monthStart } from "../../common/plans";

const BATCH_SIZE = 1000;
const TENANT_CONCURRENCY = 25;
const MAX_RETRIES = 3;

interface AbConfig {
  enabled: boolean;
  variantB?: { title?: string; body?: string };
}

/** Notification action; call buttons may carry a number pool with routing. */
interface CampaignAction {
  action: string;
  title: string;
  url?: string;
  numbers?: string[];
  strategy?: "round_robin" | "random";
}

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
  private consumedMap = new Map<string, number>();
  private readonly paused = new Set<string>();
  // generation token per campaign: pause/resume/dispatch bump it so stale pool
  // tasks from a previous run self-cancel (no double sends, no stale pacing)
  private readonly epochs = new Map<string, number>();
  // active pacing limiter per campaign so pacing can be changed live mid-blast
  private readonly limiters = new Map<string, RateLimiter>();

  /**
   * Change a campaign's send pace. Persists it and, if the blast is live,
   * updates the running limiter so the new speed takes effect immediately.
   * Operators use this from the Basic tab for daily ops.
   */
  async updatePacing(campaignId: string, perMinute: number | null): Promise<void> {
    const campaign = await this.prisma.system.campaign.findUnique({
      where: { id: campaignId },
      select: { tenantId: true },
    });
    if (!campaign) throw new BadRequestException("Campaign not found");
    const value = perMinute && perMinute > 0 ? Math.floor(perMinute) : null;
    await this.prisma.forTenant(campaign.tenantId).campaign.update({
      where: { id: campaignId },
      data: { pacingPerMinute: value },
    });
    const live = this.limiters.get(campaignId);
    if (live) live.setPerMinute(value ?? 0);
  }

  private bumpEpoch(campaignId: string): number {
    const next = (this.epochs.get(campaignId) ?? 0) + 1;
    this.epochs.set(campaignId, next);
    return next;
  }

  /**
   * True while this process is actively dispatching or draining a campaign.
   * The maintenance sweep must NOT finalize these — a low-paced blast can
   * legitimately run for hours, and a boot-resumed blast is mid-flight.
   */
  isLive(campaignId: string): boolean {
    return this.remaining.has(campaignId) || this.paused.has(campaignId);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Re-arm scheduled campaigns and resume interrupted blasts after a restart. */
  async onModuleInit() {
    const scheduled = await this.prisma.system.campaign.findMany({
      where: { status: "scheduled", scheduleAt: { not: null } },
    });
    for (const c of scheduled) {
      this.armSchedule(c.id, c.scheduleAt!);
      this.logger.log(`Re-armed scheduled campaign ${c.id} for ${c.scheduleAt!.toISOString()}`);
    }
    const interrupted = await this.prisma.system.campaign.findMany({
      where: { status: "sending" },
      select: { id: true },
    });
    for (const c of interrupted) {
      this.logger.warn(`Resuming interrupted blast ${c.id}`);
      void this.resume(c.id, true).catch((e) =>
        this.logger.error(`Auto-resume failed for ${c.id}: ${e.message}`),
      );
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
    // Node clamps setTimeout delays > ~24.86 days (2^31-1 ms) to 1 ms, which
    // would fire a far-future / monthly schedule immediately (and, for a
    // recurring campaign, loop forever re-blasting the audience). Cap each
    // hop and re-arm; only actually fire once the wall clock has arrived.
    const MAX = 2 ** 31 - 1;
    const timer = setTimeout(() => {
      this.scheduledTimers.delete(campaignId);
      if (at.getTime() - Date.now() > 1000) {
        this.armSchedule(campaignId, at); // still in the future — keep waiting
        return;
      }
      void this.fireScheduled(campaignId).catch((e) =>
        this.logger.error(`Scheduled dispatch failed for ${campaignId}: ${e.message}`),
      );
    }, Math.min(delay, MAX));
    this.scheduledTimers.set(campaignId, timer);
  }

  cancelSchedule(campaignId: string) {
    const timer = this.scheduledTimers.get(campaignId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(campaignId);
    }
  }

  async fireScheduled(campaignId: string): Promise<void> {
    const campaign = await this.prisma.system.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== "scheduled") return;

    const rec = campaign.recurrence as unknown;
    if (!isRecurrence(rec)) {
      await this.dispatch(campaignId);
      return;
    }

    const db = this.prisma.forTenant(campaign.tenantId);
    const occurrence = await db.campaign.create({
      data: {
        tenantId: campaign.tenantId,
        propertyId: campaign.propertyId,
        name: `${campaign.name} — ${new Date().toLocaleDateString("en-GB")}`,
        title: campaign.title,
        body: campaign.body,
        iconUrl: campaign.iconUrl,
        imageUrl: campaign.imageUrl,
        clickUrl: campaign.clickUrl,
        actions: campaign.actions as any,
        callNumbers: campaign.callNumbers,
        callStrategy: campaign.callStrategy,
        sourceDomain: campaign.sourceDomain,
        segmentId: campaign.segmentId,
        segmentIds: campaign.segmentIds,
        mixStrategy: campaign.mixStrategy,
        targetAll: campaign.targetAll,
        abConfig: campaign.abConfig as any,
        pacingPerMinute: campaign.pacingPerMinute,
        status: "draft",
      },
    });
    this.logger.log(`Recurring campaign ${campaign.id} → occurrence ${occurrence.id}`);
    void this.dispatch(occurrence.id).catch((e) =>
      this.logger.error(`Occurrence dispatch failed: ${e.message}`),
    );

    // advance to the next occurrence strictly in the future — after downtime,
    // fire at most one catch-up rather than one blast per missed period
    let next = nextOccurrence(campaign.scheduleAt ?? new Date(), rec);
    let guard = 0;
    while (next.getTime() <= Date.now() && guard++ < 1000) {
      next = nextOccurrence(next, rec);
    }
    await db.campaign.update({ where: { id: campaign.id }, data: { scheduleAt: next } });
    this.armSchedule(campaign.id, next);
  }

  /** Pause an active blast: queued sends stay queued, workers stop picking up. */
  async pause(campaignId: string): Promise<void> {
    const campaign = await this.prisma.system.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new BadRequestException("Campaign not found");
    if (campaign.status !== "sending") {
      throw new BadRequestException(`Campaign is ${campaign.status}, only sending campaigns can pause`);
    }
    this.paused.add(campaignId);
    this.bumpEpoch(campaignId); // invalidate every task already in the pool
    this.remaining.delete(campaignId);
    this.consumedMap.delete(campaignId);
    this.limiters.delete(campaignId);
    await this.prisma.forTenant(campaign.tenantId).campaign.update({
      where: { id: campaignId },
      data: { status: "paused" },
    });
    this.logger.log(`Campaign ${campaignId} paused`);
  }

  /** Resume a paused (or interrupted) blast: re-enqueue everything still queued. */
  async resume(campaignId: string, fromBoot = false): Promise<void> {
    const campaign = await this.prisma.system.campaign.findUnique({
      where: { id: campaignId },
      include: { property: true },
    });
    if (!campaign) throw new BadRequestException("Campaign not found");
    // "failed" is resumable too — maintenance may have finalized a blast that
    // still has queued rows; resuming re-drains them
    if (!fromBoot && campaign.status !== "paused" && campaign.status !== "failed") {
      throw new BadRequestException(`Campaign is ${campaign.status}, only paused campaigns can resume`);
    }
    const db = this.prisma.forTenant(campaign.tenantId);
    if (!fromBoot) {
      // atomic (paused|failed) → sending so a double-clicked Resume can't double-enqueue
      const claim = await db.campaign.updateMany({
        where: { id: campaignId, status: { in: ["paused", "failed"] } },
        data: { status: "sending" },
      });
      if (claim.count === 0) {
        this.logger.warn(`Resume ignored for ${campaignId} — already resumed`);
        return;
      }
    }
    this.paused.delete(campaignId);
    const epoch = this.bumpEpoch(campaignId);

    const { basePayload, variantBPayload } = this.buildPayloads(campaign);
    const vapid = this.vapidOf(campaign.property);
    // always create + register a limiter (0 interval = full speed) so pacing
    // can be adjusted live from the Basic tab, even from full speed
    const limiter = new RateLimiter(campaign.pacingPerMinute ? 60_000 / campaign.pacingPerMinute : 0);
    this.limiters.set(campaign.id, limiter);

    this.remaining.set(campaignId, Number.MAX_SAFE_INTEGER);
    let cursor: string | undefined;
    let requeued = 0;
    for (;;) {
      const queued = await db.send.findMany({
        where: { campaignId, status: "queued" },
        include: { subscriber: { select: { id: true, endpoint: true, p256dh: true, auth: true, status: true } } },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (queued.length === 0) break;
      cursor = queued[queued.length - 1].id;
      const pool = this.pool(campaign.tenantId);
      for (const send of queued) {
        if (send.subscriber.status !== "active") {
          await db.send.update({ where: { id: send.id }, data: { status: "failed", errorCode: "inactive" } });
          continue;
        }
        const payload = send.variant === "B" && variantBPayload ? variantBPayload : basePayload;
        const actions = this.resolveActions(campaign.actions as any, requeued);
        const url = this.resolveClickUrl(campaign, requeued);
        pool.add(() =>
          this.processSend(db, campaignId, campaign.tenantId, send.id, send.subscriber, {
            ...payload,
            url,
            actions,
            send_id: send.id,
          }, limiter, vapid, epoch),
        );
        requeued++;
      }
    }
    this.remaining.set(campaignId, requeued === 0 ? 0 : requeued - this.consumed(campaignId));
    if ((this.remaining.get(campaignId) ?? 0) <= 0) {
      await this.finalize(campaignId, campaign.tenantId);
    }
    this.logger.log(`Campaign ${campaignId} resumed with ${requeued} queued sends`);
  }

  async quotaRemaining(tenantId: string): Promise<number | null> {
    const tenant = await this.prisma.system.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    const quota = PLAN_QUOTAS[tenant?.plan ?? "internal"] ?? null;
    if (quota === null) return null;
    const used = await this.prisma.system.send.count({
      where: { tenantId, createdAt: { gte: monthStart() } },
    });
    return Math.max(0, quota - used);
  }

  private buildPayloads(campaign: any) {
    const abRaw = campaign.abConfig as AbConfig | null;
    const ab = abRaw?.enabled ? abRaw : null;
    const basePayload = {
      title: campaign.title,
      body: campaign.body,
      icon: campaign.iconUrl ?? campaign.property.iconUrl,
      image: campaign.imageUrl,
      url: campaign.clickUrl,
    };
    const variantBPayload = ab
      ? { ...basePayload, title: ab.variantB?.title || campaign.title, body: ab.variantB?.body || campaign.body }
      : null;
    return { basePayload, variantBPayload, ab };
  }

  private vapidOf(property: any): VapidOverride | null {
    return property.vapidPublic && property.vapidPrivate
      ? { publicKey: property.vapidPublic, privateKey: property.vapidPrivate }
      : null;
  }

  /** Per-send action resolution: call pools pick a number per lead. */
  resolveActions(actions: CampaignAction[] | null, index: number): any[] | undefined {
    if (!actions?.length) return undefined;
    return actions.map((a) => {
      if (a.numbers?.length) {
        const n =
          a.strategy === "random"
            ? a.numbers[Math.floor(Math.random() * a.numbers.length)]
            : a.numbers[index % a.numbers.length];
        return { action: a.action, title: a.title, url: `tel:${n}` };
      }
      return { action: a.action, title: a.title, url: a.url };
    });
  }

  /**
   * Body-tap target per lead. Call-first campaigns point at the call-bridge
   * page (HTTPS) rather than raw tel: — the bridge then launches the dialer,
   * which is the only path that works on iOS (tel: from a notification is
   * blocked there, but tel: from a page is honored). The service worker still
   * appends pv_sid + reports the click, so CTR/CDR/revenue all work.
   */
  private resolveClickUrl(campaign: any, index: number): string {
    const nums: string[] = campaign.callNumbers ?? [];
    if (nums.length > 0) {
      const n =
        campaign.callStrategy === "random"
          ? nums[Math.floor(Math.random() * nums.length)]
          : nums[index % nums.length];
      // serve the bridge from the property's branded call domain when set
      // (must point at this server) so the address bar shows their domain, not
      // ours; otherwise fall back to this server's own domain
      const callDomain = campaign.property?.callDomain;
      const base = callDomain
        ? `https://${callDomain}`
        : process.env.APP_BASE_URL ?? "http://localhost:3000";
      return `${base}/api/v1/public/call?n=${encodeURIComponent(n)}`;
    }
    return campaign.clickUrl;
  }

  /**
   * Multi-segment audience with lead-mix strategy:
   *  - mixed: interleave leads across segments evenly
   *  - sequential: finish segment 1, then 2, ...
   *  - zone: group leads by timezone (send zone by zone)
   * Returns ordered subscriber ids, or null when no segments (stream all).
   */
  private async resolveAudienceOrder(
    db: TenantClient,
    campaign: any,
  ): Promise<string[] | null> {
    // explicit "everyone" → stream all actives; no segments and no targetAll → nobody
    if (campaign.targetAll) return null;
    const segmentIds: string[] =
      campaign.segmentIds?.length > 0
        ? campaign.segmentIds
        : campaign.segmentId
          ? [campaign.segmentId]
          : [];
    if (segmentIds.length === 0) return [];

    const segments = await db.segment.findMany({ where: { id: { in: segmentIds } } });
    // preserve the order segments were attached in
    const ordered = segmentIds
      .map((id) => segments.find((s) => s.id === id))
      .filter(Boolean) as typeof segments;

    // segmented sends must materialize ids to interleave/dedup across segments.
    // Cap the total so a pathological audience can't OOM the box; the targetAll
    // path (the truly huge case) streams with a cursor and isn't affected.
    const MAX_AUDIENCE = 500_000;
    const lists: { id: string; timezone: string | null }[][] = [];
    let loaded = 0;
    for (const seg of ordered) {
      if (loaded >= MAX_AUDIENCE) break;
      const rows = await db.subscriber.findMany({
        where: {
          ...segmentAudienceWhere(seg.criteria as SegmentCriteria),
          propertyId: campaign.propertyId,
          status: "active",
        },
        select: { id: true, timezone: true },
        orderBy: { id: "asc" },
        take: MAX_AUDIENCE - loaded,
      });
      loaded += rows.length;
      lists.push(rows);
    }
    if (loaded >= MAX_AUDIENCE) {
      this.logger.warn(
        `Campaign ${campaign.id} audience capped at ${MAX_AUDIENCE} — split very large segments across multiple campaigns`,
      );
    }

    const seen = new Set<string>();
    const result: { id: string; timezone: string | null }[] = [];

    if (campaign.mixStrategy === "sequential") {
      for (const list of lists) {
        for (const row of list) {
          if (!seen.has(row.id)) { seen.add(row.id); result.push(row); }
        }
      }
    } else {
      // round-robin interleave (also the base order for zone)
      const idx = lists.map(() => 0);
      for (;;) {
        let advanced = false;
        for (let l = 0; l < lists.length; l++) {
          while (idx[l] < lists[l].length && seen.has(lists[l][idx[l]].id)) idx[l]++;
          if (idx[l] < lists[l].length) {
            const row = lists[l][idx[l]++];
            seen.add(row.id);
            result.push(row);
            advanced = true;
          }
        }
        if (!advanced) break;
      }
    }

    if (campaign.mixStrategy === "zone") {
      // stable sort by timezone so each zone completes before the next begins
      result.sort((a, b) => (a.timezone ?? "zzz").localeCompare(b.timezone ?? "zzz"));
    }

    return result.map((r) => r.id);
  }

  /** Orchestrator: `campaign:dispatch` */
  async dispatch(campaignId: string): Promise<void> {
    const campaign = await this.prisma.system.campaign.findUnique({
      where: { id: campaignId },
      include: { property: true },
    });
    if (!campaign) throw new Error("Campaign not found");
    if (!["draft", "scheduled"].includes(campaign.status)) {
      throw new Error(`Campaign is ${campaign.status}, cannot dispatch`);
    }

    // "none means none": without segments or an explicit target-all there is nothing to dial
    if (!campaign.targetAll && !campaign.segmentIds?.length && !campaign.segmentId) {
      throw new BadRequestException(
        "No leads selected — pick at least one segment or enable 'All active subscribers'",
      );
    }

    let remainingQuota = await this.quotaRemaining(campaign.tenantId);
    if (remainingQuota !== null && remainingQuota <= 0) {
      throw new BadRequestException("Monthly push quota exhausted — upgrade the plan in Settings");
    }

    const db = this.prisma.forTenant(campaign.tenantId);
    // Atomic claim: only one caller can move the campaign draft/scheduled →
    // sending. A double-clicked Send Now (or two operators at once) makes the
    // loser's updateMany match 0 rows, so we abort instead of double-blasting.
    const claim = await db.campaign.updateMany({
      where: { id: campaign.id, status: { in: ["draft", "scheduled"] } },
      data: {
        status: "sending",
        startedAt: new Date(),
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        totalExpiredPruned: 0,
      },
    });
    if (claim.count === 0) {
      this.logger.warn(`Dispatch ignored for ${campaignId} — already claimed (double send?)`);
      return;
    }
    this.paused.delete(campaignId);
    const epoch = this.bumpEpoch(campaignId);

    const { basePayload, variantBPayload, ab } = this.buildPayloads(campaign);
    const vapid = this.vapidOf(campaign.property);
    // always create + register a limiter (0 interval = full speed) so pacing
    // can be adjusted live from the Basic tab, even from full speed
    const limiter = new RateLimiter(campaign.pacingPerMinute ? 60_000 / campaign.pacingPerMinute : 0);
    this.limiters.set(campaign.id, limiter);

    const capDay = campaign.property.frequencyCapPerDay;
    const capWeek = campaign.property.frequencyCapPerWeek;
    const dayAgo = new Date(Date.now() - 86400_000);
    const weekAgo = new Date(Date.now() - 7 * 86400_000);

    const orderedIds = await this.resolveAudienceOrder(db, campaign);

    let cursor: string | undefined;
    let orderedPos = 0;
    let targeted = 0;
    let quotaHit = false;
    this.remaining.set(campaign.id, Number.MAX_SAFE_INTEGER);

    for (;;) {
      // NOTE: we intentionally do NOT stop targeting on pause. Targeting only
      // creates queued send rows (no pushes — those pool tasks self-cancel via
      // the bumped epoch while paused). Stopping here would silently drop every
      // not-yet-targeted lead, since resume only replays existing queued rows.
      // Letting targeting finish means the full audience is captured and resume
      // delivers all of it.

      let batch: { id: string; endpoint: string; p256dh: string; auth: string }[];
      if (orderedIds) {
        const chunk = orderedIds.slice(orderedPos, orderedPos + BATCH_SIZE);
        orderedPos += chunk.length;
        if (chunk.length === 0) break;
        const rows = await db.subscriber.findMany({
          where: { id: { in: chunk }, status: "active" },
          select: { id: true, endpoint: true, p256dh: true, auth: true },
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        batch = chunk.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
      } else {
        batch = await db.subscriber.findMany({
          where: { propertyId: campaign.propertyId, status: "active" },
          select: { id: true, endpoint: true, p256dh: true, auth: true },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) break;
        cursor = batch[batch.length - 1].id;
      }
      if (batch.length === 0) continue;

      // frequency caps (server-side, §7 step 3). Count queued AND sent rows,
      // by createdAt — otherwise N concurrent/paced campaigns each see only
      // their already-delivered rows (0 at queue time) and every one blasts,
      // blowing past the cap. Queued rows created this window count too.
      const ids = batch.map((s) => s.id);
      // Send rows are queued → sent/failed/expired (there is no "sending"
      // SendStatus — that's a Campaign status). Count queued (in-flight) + sent
      // (delivered) against the cap; both represent a push the lead will/did get.
      const capStatuses: any = ["queued", "sent"];
      const [dayCounts, weekCounts] = await Promise.all([
        db.send.groupBy({
          by: ["subscriberId"],
          where: { subscriberId: { in: ids }, status: { in: capStatuses }, createdAt: { gte: dayAgo } },
          _count: { subscriberId: true },
        }),
        db.send.groupBy({
          by: ["subscriberId"],
          where: { subscriberId: { in: ids }, status: { in: capStatuses }, createdAt: { gte: weekAgo } },
          _count: { subscriberId: true },
        }),
      ]);
      const dayMap = new Map(dayCounts.map((c) => [c.subscriberId, c._count.subscriberId]));
      const weekMap = new Map(weekCounts.map((c) => [c.subscriberId, c._count.subscriberId]));
      let eligible = batch.filter(
        (s) => (dayMap.get(s.id) ?? 0) < capDay && (weekMap.get(s.id) ?? 0) < capWeek,
      );
      if (eligible.length === 0) continue;

      if (remainingQuota !== null) {
        // re-read from the DB each batch: queued sends are inserted immediately,
        // so this count already reflects any concurrent campaign's dispatch,
        // shrinking the cross-campaign over-send window to at most one batch
        const fresh = (await this.quotaRemaining(campaign.tenantId)) ?? Number.MAX_SAFE_INTEGER;
        remainingQuota = fresh;
        if (fresh <= 0) { quotaHit = true; break; }
        if (eligible.length > fresh) {
          eligible = eligible.slice(0, fresh);
          quotaHit = true;
        }
      }

      const sendRows = eligible.map((s, i) => ({
        id: randomUUID(),
        tenantId: campaign.tenantId,
        campaignId: campaign.id,
        subscriberId: s.id,
        status: "queued" as const,
        variant: ab ? ((targeted + i) % 2 === 0 ? "A" : "B") : null,
      }));
      await db.send.createMany({ data: sendRows });

      const pool = this.pool(campaign.tenantId);
      for (let i = 0; i < sendRows.length; i++) {
        const send = sendRows[i];
        const sub = eligible[i];
        const payload = send.variant === "B" && variantBPayload ? variantBPayload : basePayload;
        // snapshot NOW — the closure runs later, when `targeted` has moved on;
        // resolving the call-pool index against the live counter collapsed
        // round-robin routing to a single number for every deferred send
        const actionIndex = targeted + i;
        const actions = this.resolveActions(campaign.actions as any, actionIndex);
        const url = this.resolveClickUrl(campaign, actionIndex);
        pool.add(() =>
          this.processSend(db, campaign.id, campaign.tenantId, send.id, sub, {
            ...payload,
            url,
            actions,
            send_id: send.id,
          }, limiter, vapid, epoch),
        );
      }
      targeted += sendRows.length;
      if (quotaHit) break;
    }

    await db.campaign.update({
      where: { id: campaign.id },
      data: { totalTargeted: targeted },
    });
    if (!this.paused.has(campaign.id)) {
      this.remaining.set(campaign.id, targeted === 0 ? 0 : targeted - this.consumed(campaign.id));
      if ((this.remaining.get(campaign.id) ?? 0) <= 0) {
        await this.finalize(campaign.id, campaign.tenantId);
      }
    }
    this.logger.log(
      `Campaign ${campaign.id}: targeted ${targeted}${quotaHit ? " (capped by plan quota)" : ""}`,
    );
  }

  private consumed(campaignId: string) {
    return this.consumedMap.get(campaignId) ?? 0;
  }

  private async done(campaignId: string, tenantId: string) {
    const rem = this.remaining.get(campaignId);
    if (rem === Number.MAX_SAFE_INTEGER) {
      this.consumedMap.set(campaignId, this.consumed(campaignId) + 1);
      return;
    }
    if (rem === undefined) return; // paused: bookkeeping reset, resume re-counts
    const next = rem - 1;
    this.remaining.set(campaignId, next);
    if (next <= 0) {
      await this.finalize(campaignId, tenantId);
    }
  }

  private async finalize(campaignId: string, tenantId: string) {
    this.remaining.delete(campaignId);
    this.consumedMap.delete(campaignId);
    this.limiters.delete(campaignId);
    const db = this.prisma.forTenant(tenantId);
    const current = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (current?.status === "paused") return; // don't overwrite a pause
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
        totalDelivered: sent,
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
    vapid: VapidOverride | null = null,
    epoch = 0,
  ): Promise<void> {
    const stale = () =>
      this.paused.has(campaignId) || (this.epochs.get(campaignId) ?? epoch) !== epoch;
    // paused or superseded run: leave the send queued; resume() re-enqueues it
    if (stale()) return;

    // Phase 1: the actual push attempt (the only thing that can be a "failure").
    // Separated from result-recording so a DB hiccup AFTER a delivered push
    // can never mislabel it as failed / double-count.
    let pushError: PushError | Error | null = null;
    try {
      if (limiter) await limiter.wait();
      if (stale()) return; // paused/superseded while waiting for a pacing slot
      let attempt = 0;
      for (;;) {
        attempt++;
        try {
          await this.push.send(sub, payload, vapid);
          break;
        } catch (e) {
          if (e instanceof PushError && e.statusCode === 429 && attempt < MAX_RETRIES) {
            await sleep(1000 * 2 ** (attempt - 1));
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      pushError = e as Error;
    }

    // Phase 2: record the outcome. Wrapped so a DB error here is logged, not
    // thrown — and it never flips a delivered push into a failure.
    try {
      if (pushError === null) {
        const now = new Date();
        await db.send.update({ where: { id: sendId }, data: { status: "sent", sentAt: now } });
        await db.subscriber.update({
          where: { id: sub.id },
          data: { pushesReceived: { increment: 1 }, lastPushAt: now },
        });
        await db.campaign.update({
          where: { id: campaignId },
          data: { totalSent: { increment: 1 }, totalDelivered: { increment: 1 } },
        });
      } else {
        const code = pushError instanceof PushError ? pushError.statusCode : null;
        if (code === 404 || code === 410) {
          await db.send.update({
            where: { id: sendId },
            data: { status: "expired", errorCode: String(code) },
          });
          await db.subscriber.update({ where: { id: sub.id }, data: { status: "expired" } });
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
      }
    } catch (dbErr: any) {
      this.logger.error(`send ${sendId} result-record failed: ${dbErr.message}`);
    } finally {
      // always decrement completion bookkeeping so the campaign can finalize
      await this.done(campaignId, tenantId).catch(() => undefined);
    }
  }
}
