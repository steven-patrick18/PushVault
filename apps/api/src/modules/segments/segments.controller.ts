import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard, propertyScope, assertPropertyAccess } from "../../common/auth.guard";
import { compileCriteria, segmentAudienceWhere, SegmentCriteria } from "./segment-compiler";
import { SubscriberFilterParams, buildSubscriberWhere } from "../../common/subscriber-filters";
import { MembershipService } from "./membership.service";

// cumulative "last X" windows for blast activity, in minutes
const ACTIVITY_WINDOWS = [
  { key: "10m", label: "Last 10 min", minutes: 10 },
  { key: "30m", label: "Last 30 min", minutes: 30 },
  { key: "1h", label: "Last 1 hr", minutes: 60 },
  { key: "3h", label: "Last 3 hrs", minutes: 180 },
  { key: "6h", label: "Last 6 hrs", minutes: 360 },
  { key: "24h", label: "Last 24 hrs", minutes: 1440 },
  { key: "7d", label: "Last 7 days", minutes: 10080 },
];

class CreateSegmentDto {
  @IsUUID()
  propertyId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsObject()
  criteria: SegmentCriteria;

  @IsOptional()
  @IsBoolean()
  isDynamic?: boolean;
}

class UpdateSegmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsObject()
  criteria?: SegmentCriteria;
}

@Controller("segments")
@UseGuards(JwtAuthGuard)
export class SegmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("property_id") propertyId?: string) {
    return this.db(user).segment.findMany({
      where: { ...propertyScope(user), ...(propertyId ? { propertyId } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSegmentDto) {
    compileCriteria(dto.criteria); // validate before saving
    const segment = await this.db(user).segment.create({
      data: {
        tenantId: user.tenantId,
        propertyId: dto.propertyId,
        name: dto.name,
        criteria: dto.criteria as any,
        isDynamic: dto.isDynamic ?? true,
      },
    });
    await this.audit(user, "segment.create", segment.id, null, dto.criteria);
    return segment;
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    if (dto.criteria) compileCriteria(dto.criteria);
    const before = await this.db(user).segment.findUnique({ where: { id } });
    const segment = await this.db(user).segment.update({
      where: { id },
      data: { name: dto.name, criteria: dto.criteria as any },
    });
    await this.audit(user, "segment.update", id, before?.criteria, dto.criteria);
    return segment;
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.db(user).segment.delete({ where: { id } });
    await this.audit(user, "segment.delete", id, null, null);
    return { ok: true };
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
        entityType: "segment",
        entityId,
        before: before as any,
        after: after as any,
      },
    });
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const segment = await this.db(user).segment.findUnique({
      where: { id },
      include: { property: { select: { id: true, name: true } } },
    });
    if (!segment) throw new NotFoundException("Segment not found");
    assertPropertyAccess(user, segment.propertyId);
    return segment;
  }

  /** Evaluate the live audience size for this segment. */
  @Post(":id/count")
  async count(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.db(user);
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException("Segment not found");
    const where = segmentAudienceWhere(segment.criteria as SegmentCriteria);
    const count = await db.subscriber.count({
      where: { ...where, propertyId: segment.propertyId, status: "active" },
    });
    await db.segment.update({
      where: { id },
      data: { cachedCount: count, cachedAt: new Date() },
    });
    return { count };
  }

  /** Leads currently in the segment (filter matches + manual adds − manual removes). */
  @Get(":id/members")
  async members(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("page") page = "1",
    @Query("page_size") pageSize = "25",
  ) {
    const db = this.db(user);
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException("Segment not found");
    assertPropertyAccess(user, segment.propertyId);
    const criteria = segment.criteria as SegmentCriteria;
    const where = {
      ...segmentAudienceWhere(criteria),
      propertyId: segment.propertyId,
      status: "active" as const,
    };
    const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [rows, total] = await Promise.all([
      db.subscriber.findMany({
        where,
        orderBy: { subscribedAt: "desc" },
        skip,
        take,
        select: {
          id: true, status: true, utmCampaign: true, utmSource: true, device: true,
          browser: true, country: true, city: true, pushesReceived: true, pushesClicked: true,
          lastPushAt: true, subscribedAt: true,
        },
      }),
      db.subscriber.count({ where }),
    ]);
    const manualInclude = new Set(criteria.manual_include ?? []);
    return {
      rows: rows.map((r) => ({ ...r, manuallyAdded: manualInclude.has(r.id) })),
      total,
      page: Number(page),
      pageSize: take,
      manualExcludeCount: (criteria.manual_exclude ?? []).length,
    };
  }

  /** Leads of the property NOT in the segment — candidates to add. */
  @Get(":id/candidates")
  async candidates(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("search") search?: string,
    @Query("page") page = "1",
  ) {
    const db = this.db(user);
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException("Segment not found");
    assertPropertyAccess(user, segment.propertyId);
    const audience = segmentAudienceWhere(segment.criteria as SegmentCriteria);
    const where: any = {
      propertyId: segment.propertyId,
      status: "active",
      NOT: Object.keys(audience).length ? audience : undefined,
      ...(search
        ? {
            OR: [
              { utmCampaign: { contains: search, mode: "insensitive" } },
              { utmSource: { contains: search, mode: "insensitive" } },
              { country: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const take = 25;
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [rows, total] = await Promise.all([
      db.subscriber.findMany({
        where,
        orderBy: { subscribedAt: "desc" },
        skip,
        take,
        select: {
          id: true, utmCampaign: true, utmSource: true, device: true,
          country: true, subscribedAt: true,
        },
      }),
      db.subscriber.count({ where }),
    ]);
    return { rows, total, page: Number(page), pageSize: take };
  }

  /** Manually add a lead to the segment. */
  @Post(":id/members")
  async addMember(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { subscriber_id: string },
  ) {
    return this.mutateManual(user, id, body.subscriber_id, "add");
  }

  /** Manually remove a lead from the segment. */
  @Delete(":id/members/:subscriberId")
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("subscriberId", ParseUUIDPipe) subscriberId: string,
  ) {
    return this.mutateManual(user, id, subscriberId, "remove");
  }

  private async mutateManual(user: AuthUser, id: string, subscriberId: string, op: "add" | "remove") {
    const db = this.db(user);
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException("Segment not found");
    if (op === "add") {
      // one lead lives in exactly one segment: adding here evicts it everywhere else
      const moved = await this.membership.exclusiveAssign(
        user.tenantId,
        segment.propertyId,
        segment.id,
        [subscriberId],
      );
      await this.audit(user, "segment.member_add", id, null, { subscriberId, evictedFromOthers: moved });
    } else {
      const criteria = (segment.criteria as SegmentCriteria) ?? {};
      const include = new Set(criteria.manual_include ?? []);
      const exclude = new Set(criteria.manual_exclude ?? []);
      exclude.add(subscriberId);
      include.delete(subscriberId);
      await db.segment.update({
        where: { id },
        data: { criteria: { ...criteria, manual_include: [...include], manual_exclude: [...exclude] } as any },
      });
      await this.audit(user, "segment.member_remove", id, null, { subscriberId });
    }
    return { ok: true };
  }

  /** Bulk assign: every lead matching the filters moves into this segment (exclusively). */
  @Post(":id/assign-filtered")
  async assignFiltered(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { filters?: SubscriberFilterParams },
  ) {
    const db = this.db(user);
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException("Segment not found");
    const where = {
      ...buildSubscriberWhere(body.filters ?? {}),
      propertyId: segment.propertyId, // never cross properties
    };
    const matches = await db.subscriber.findMany({
      where,
      select: { id: true },
      take: 50_000,
    });
    if (matches.length === 0) return { assigned: 0, evictedFromOtherSegments: 0 };
    const evicted = await this.membership.exclusiveAssign(
      user.tenantId,
      segment.propertyId,
      segment.id,
      matches.map((m) => m.id),
    );
    await this.audit(user, "segment.assign_filtered", id, null, {
      filters: body.filters,
      assigned: matches.length,
    });
    return { assigned: matches.length, evictedFromOtherSegments: evicted };
  }

  /** Blast activity for this segment's leads in cumulative time windows. */
  @Get(":id/activity")
  async activity(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.db(user);
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException("Segment not found");
    assertPropertyAccess(user, segment.propertyId);
    const audience = segmentAudienceWhere(segment.criteria as SegmentCriteria);
    const since = new Date(Date.now() - ACTIVITY_WINDOWS[ACTIVITY_WINDOWS.length - 1].minutes * 60_000);

    // one query, bucketed in memory (capped — fine at this scale)
    const sends = await db.send.findMany({
      where: {
        createdAt: { gte: since },
        subscriber: { ...audience, propertyId: segment.propertyId },
      },
      select: { status: true, clicked: true, createdAt: true },
      take: 50_000,
    });

    const now = Date.now();
    return ACTIVITY_WINDOWS.map((w) => {
      const cutoff = now - w.minutes * 60_000;
      let sent = 0, failed = 0, expired = 0, queued = 0, clicked = 0;
      for (const s of sends) {
        if (s.createdAt.getTime() < cutoff) continue;
        if (s.status === "sent") sent++;
        else if (s.status === "failed") failed++;
        else if (s.status === "expired") expired++;
        else queued++;
        if (s.clicked) clicked++;
      }
      return {
        ...w,
        sent,
        clicked,
        failed,
        expired,
        queued,
        ctr: sent > 0 ? +((clicked / sent) * 100).toFixed(2) : null,
      };
    });
  }
}
