import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { SegmentCriteria } from "./segment-compiler";

export interface AutoAssignRule {
  segmentId: string;
  weight: number;
}

export interface AutoAssignConfig {
  status: "active" | "paused";
  rules: AutoAssignRule[];
  /** running distribution counters, keyed by segmentId */
  counts?: Record<string, number>;
}

/**
 * Segment membership rules live here so both the dashboard API and the
 * public subscribe path share them. Core invariant: ONE lead lives in ONE
 * segment — assignment always evicts from sibling segments.
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger("Membership");
  // serialize auto-assigns per property: concurrent subscribes would otherwise
  // lose counter increments and manual-list updates (read-modify-write races)
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Serialize a unit of membership work per property. ALL assignment paths
   * (dashboard add / bulk assign / auto-assign) run through here so their
   * read-modify-write of segment criteria can't interleave and land a lead in
   * two segments or lose counter increments. Single-process guarantee; a
   * multi-instance deployment would additionally need a DB advisory lock.
   */
  private runExclusive<T>(propertyId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(propertyId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // keep the tail so the next caller waits; swallow to avoid unhandled rejection
    this.chains.set(propertyId, next.catch(() => undefined));
    return next;
  }

  /** Returns how many sibling segments the ids were evicted from. Serialized. */
  exclusiveAssign(
    tenantId: string,
    propertyId: string,
    targetSegmentId: string,
    ids: string[],
  ): Promise<number> {
    return this.runExclusive(propertyId, () =>
      this._exclusiveAssign(tenantId, propertyId, targetSegmentId, ids),
    );
  }

  private async _exclusiveAssign(
    tenantId: string,
    propertyId: string,
    targetSegmentId: string,
    ids: string[],
  ): Promise<number> {
    const db = this.prisma.forTenant(tenantId);
    const idSet = new Set(ids);
    // target must still exist, or we'd evict the leads from every sibling and
    // include them nowhere (black-hole). Bail without mutating if it's gone.
    const target = await db.segment.findUnique({ where: { id: targetSegmentId }, select: { id: true } });
    if (!target) {
      this.logger.warn(`exclusiveAssign skipped — target segment ${targetSegmentId} no longer exists`);
      return 0;
    }
    const siblings = await db.segment.findMany({ where: { propertyId } });
    let touchedOthers = 0;
    for (const seg of siblings) {
      const criteria = (seg.criteria as SegmentCriteria) ?? {};
      const include = new Set(criteria.manual_include ?? []);
      const exclude = new Set(criteria.manual_exclude ?? []);
      if (seg.id === targetSegmentId) {
        for (const sid of idSet) {
          include.add(sid);
          exclude.delete(sid);
        }
      } else {
        let changed = false;
        for (const sid of idSet) {
          if (include.has(sid)) { include.delete(sid); changed = true; }
          if (!exclude.has(sid)) { exclude.add(sid); changed = true; }
        }
        if (!changed) continue;
        touchedOthers++;
      }
      await db.segment.update({
        where: { id: seg.id },
        data: {
          criteria: { ...criteria, manual_include: [...include], manual_exclude: [...exclude] } as any,
        },
      });
    }
    return touchedOthers;
  }

  /**
   * Auto-distribution: a new subscriber is exclusively assigned to one of the
   * configured segments, honoring the weights via least-filled-ratio
   * (deterministic weighted round-robin). Serialized per property.
   */
  autoAssignNewLead(tenantId: string, propertyId: string, subscriberId: string): Promise<void> {
    return this.runExclusive(propertyId, () =>
      this.doAutoAssign(tenantId, propertyId, subscriberId),
    ).catch((e) => this.logger.error(`auto-assign failed for ${subscriberId}: ${e.message}`));
  }

  private async doAutoAssign(tenantId: string, propertyId: string, subscriberId: string) {
    const db = this.prisma.forTenant(tenantId);
    const property = await db.property.findUnique({
      where: { id: propertyId },
      select: { autoAssign: true },
    });
    const config = property?.autoAssign as AutoAssignConfig | null;
    if (!config || config.status !== "active" || !config.rules?.length) return;

    // only consider rules whose segment still exists (deleted segments are
    // dropped so new leads aren't black-holed into a missing target)
    const liveSegments = new Set(
      (await db.segment.findMany({ where: { propertyId }, select: { id: true } })).map((s) => s.id),
    );
    const rules = config.rules.filter((r) => r.weight > 0 && liveSegments.has(r.segmentId));
    if (rules.length === 0) return;
    const counts: Record<string, number> = { ...(config.counts ?? {}) };

    // pick the rule whose fill ratio (assigned/weight) is lowest
    let chosen = rules[0];
    let best = Infinity;
    for (const r of rules) {
      const ratio = (counts[r.segmentId] ?? 0) / r.weight;
      if (ratio < best) {
        best = ratio;
        chosen = r;
      }
    }

    // already inside runExclusive → call the internal impl (avoid re-queueing)
    await this._exclusiveAssign(tenantId, propertyId, chosen.segmentId, [subscriberId]);
    counts[chosen.segmentId] = (counts[chosen.segmentId] ?? 0) + 1;
    await db.property.update({
      where: { id: propertyId },
      data: { autoAssign: { ...config, counts } as any },
    });
    this.logger.log(`auto-assigned new lead ${subscriberId} → segment ${chosen.segmentId}`);
  }

  /**
   * Remove a deleted segment from a property's auto-assign rules/counts so new
   * leads aren't routed into a segment that no longer exists.
   */
  async cleanupDeletedSegment(tenantId: string, propertyId: string, segmentId: string) {
    return this.runExclusive(propertyId, async () => {
      const db = this.prisma.forTenant(tenantId);
      const property = await db.property.findUnique({
        where: { id: propertyId },
        select: { autoAssign: true },
      });
      const config = property?.autoAssign as AutoAssignConfig | null;
      if (!config) return;
      const rules = (config.rules ?? []).filter((r) => r.segmentId !== segmentId);
      const counts = { ...(config.counts ?? {}) };
      delete counts[segmentId];
      await db.property.update({
        where: { id: propertyId },
        data: { autoAssign: { ...config, rules, counts } as any },
      });
    });
  }
}
