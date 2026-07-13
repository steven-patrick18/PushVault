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
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Returns how many sibling segments the ids were evicted from. */
  async exclusiveAssign(
    tenantId: string,
    propertyId: string,
    targetSegmentId: string,
    ids: string[],
  ): Promise<number> {
    const db = this.prisma.forTenant(tenantId);
    const idSet = new Set(ids);
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
    const prev = this.chains.get(propertyId) ?? Promise.resolve();
    const next = prev
      .then(() => this.doAutoAssign(tenantId, propertyId, subscriberId))
      .catch((e) => this.logger.error(`auto-assign failed for ${subscriberId}: ${e.message}`));
    this.chains.set(propertyId, next);
    return next;
  }

  private async doAutoAssign(tenantId: string, propertyId: string, subscriberId: string) {
    const db = this.prisma.forTenant(tenantId);
    const property = await db.property.findUnique({
      where: { id: propertyId },
      select: { autoAssign: true },
    });
    const config = property?.autoAssign as AutoAssignConfig | null;
    if (!config || config.status !== "active" || !config.rules?.length) return;

    const rules = config.rules.filter((r) => r.weight > 0);
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

    await this.exclusiveAssign(tenantId, propertyId, chosen.segmentId, [subscriberId]);
    counts[chosen.segmentId] = (counts[chosen.segmentId] ?? 0) + 1;
    await db.property.update({
      where: { id: propertyId },
      data: { autoAssign: { ...config, counts } as any },
    });
    this.logger.log(`auto-assigned new lead ${subscriberId} → segment ${chosen.segmentId}`);
  }
}
