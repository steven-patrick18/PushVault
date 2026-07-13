import {
  BadRequestException,
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
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard, propertyScope, assertPropertyAccess } from "../../common/auth.guard";
import { CampaignRunnerService } from "./campaign-runner.service";
import { PushService, PushError } from "./push.service";
import { describeRecurrence, isRecurrence } from "./recurrence";
import { normalizeRates } from "../settings/settings.controller";

class CreateCampaignDto {
  @IsUUID()
  propertyId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  body: string;

  @IsString()
  clickUrl: string;

  // call-first: pooled numbers dialed on body tap (overrides clickUrl)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callNumbers?: string[];

  @IsOptional()
  @IsIn(["round_robin", "random"])
  callStrategy?: string;

  @IsOptional()
  @IsString()
  sourceDomain?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  actions?: { action: string; title: string; url: string }[];

  @IsOptional()
  @IsUUID()
  segmentId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  segmentIds?: string[];

  @IsOptional()
  @IsIn(["mixed", "sequential", "zone"])
  mixStrategy?: string;

  @IsOptional()
  @IsBoolean()
  targetAll?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  pacingPerMinute?: number;

  @IsOptional()
  @IsObject()
  abConfig?: { enabled: boolean; variantB?: { title?: string; body?: string } };
}

class UpdateCampaignDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() clickUrl?: string;
  // null clears the icon/image (empty field in the designer)
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() iconUrl?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() imageUrl?: string | null;
  @IsOptional() @IsArray() actions?: unknown[];
  @IsOptional() @IsArray() @IsString({ each: true }) callNumbers?: string[];
  @IsOptional() @IsIn(["round_robin", "random"]) callStrategy?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() sourceDomain?: string | null;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) segmentIds?: string[];
  @IsOptional() @IsIn(["mixed", "sequential", "zone"]) mixStrategy?: string;
  @IsOptional() @IsBoolean() targetAll?: boolean;
  // null = unassign segment (target all active subscribers)
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() segmentId?: string | null;
  // null = full speed
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) pacingPerMinute?: number | null;
  // null = disable A/B
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsObject() abConfig?: object | null;
}

class ScheduleDto {
  @IsDateString()
  schedule_at: string;

  // {freq: DAILY|WEEKLY|MONTHLY, interval?, byweekday?: number[]} — omit for one-shot
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  recurrence?: { freq: string; interval?: number; byweekday?: number[] } | null;
}

class TestSendDto {
  @IsUUID()
  subscriber_id: string;
}

@Controller("campaigns")
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: CampaignRunnerService,
    private readonly push: PushService,
  ) {}

  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("property_id") propertyId?: string) {
    return this.db(user).campaign.findMany({
      where: { ...propertyScope(user), ...(propertyId ? { propertyId } : {}) },
      orderBy: { createdAt: "desc" },
      include: { segment: { select: { id: true, name: true } } },
    });
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const campaign = await this.db(user).campaign.findUnique({
      where: { id },
      include: { segment: { select: { id: true, name: true } } },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    assertPropertyAccess(user, campaign.propertyId);
    return campaign;
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    const campaign = await this.db(user).campaign.create({
      data: {
        tenantId: user.tenantId,
        propertyId: dto.propertyId,
        name: dto.name,
        title: dto.title,
        body: dto.body,
        clickUrl: dto.clickUrl,
        callNumbers: dto.callNumbers ?? [],
        callStrategy: dto.callStrategy ?? "round_robin",
        sourceDomain: dto.sourceDomain ?? null,
        iconUrl: dto.iconUrl ?? null,
        imageUrl: dto.imageUrl ?? null,
        actions: (dto.actions as any) ?? undefined,
        segmentId: dto.segmentId ?? null,
        segmentIds: dto.segmentIds ?? [],
        mixStrategy: dto.mixStrategy ?? "mixed",
        targetAll: dto.targetAll ?? false,
        pacingPerMinute: dto.pacingPerMinute ?? null,
        abConfig: (dto.abConfig as any) ?? undefined,
      },
    });
    await this.audit(user, "campaign.create", campaign.id);
    return campaign;
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (campaign.status === "sending") {
      throw new BadRequestException("Pause or let the campaign finish before deleting");
    }
    // sends cascade-delete via the FK; scheduled timers are cleared
    this.runner.cancelSchedule(id);
    await this.db(user).send.deleteMany({ where: { campaignId: id } });
    await this.db(user).campaign.delete({ where: { id } });
    await this.audit(user, "campaign.delete", id);
    return { ok: true };
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    const existing = await this.db(user).campaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Campaign not found");
    // paused blasts are editable: changes apply to the remaining queued leads on resume
    if (!["draft", "scheduled", "paused"].includes(existing.status)) {
      throw new BadRequestException("Only draft, scheduled or paused campaigns can be edited");
    }
    return this.db(user).campaign.update({ where: { id }, data: dto as any });
  }

  @Post(":id/send-now")
  async sendNow(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (!campaign.targetAll && !campaign.segmentIds?.length && !campaign.segmentId) {
      throw new BadRequestException(
        "No leads selected — pick at least one segment or enable 'All active subscribers'",
      );
    }
    const remaining = await this.runner.quotaRemaining(user.tenantId);
    if (remaining !== null && remaining <= 0) {
      throw new BadRequestException("Monthly push quota exhausted — upgrade the plan in Settings");
    }
    await this.audit(user, "campaign.send", id);
    // dispatch runs async; the dashboard polls the live monitor for progress.
    // MUST be caught — an unhandled rejection here would take the process down.
    void this.runner.dispatch(id).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`dispatch failed for ${id}: ${e.message}`);
    });
    return { ok: true, status: "sending" };
  }

  @Post(":id/schedule")
  async schedule(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ScheduleDto,
  ) {
    const at = new Date(dto.schedule_at);
    if (at.getTime() < Date.now()) throw new BadRequestException("schedule_at is in the past");
    if (dto.recurrence && !isRecurrence(dto.recurrence)) {
      throw new BadRequestException("recurrence.freq must be DAILY, WEEKLY or MONTHLY");
    }
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (!["draft", "scheduled"].includes(campaign.status)) {
      throw new BadRequestException(`Campaign is ${campaign.status}`);
    }
    await this.db(user).campaign.update({
      where: { id },
      data: {
        status: "scheduled",
        scheduleAt: at,
        recurrence: (dto.recurrence as any) ?? null,
      },
    });
    this.runner.armSchedule(id, at);
    await this.audit(user, "campaign.schedule", id);
    return {
      ok: true,
      schedule_at: at.toISOString(),
      recurrence: dto.recurrence ? describeRecurrence(dto.recurrence as any) : null,
    };
  }

  /** Pause an active blast — queued sends wait until resume. */
  @Post(":id/pause")
  async pause(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    await this.runner.pause(id);
    await this.audit(user, "campaign.pause", id);
    return { ok: true, status: "paused" };
  }

  @Post(":id/resume")
  async resume(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    await this.audit(user, "campaign.resume", id);
    void this.runner.resume(id).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`resume failed for ${id}: ${e.message}`);
    });
    return { ok: true, status: "sending" };
  }

  /** Vicidial-style live monitor: counters + rate + ETA, polled by the Basic view. */
  @Get(":id/live")
  async live(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.db(user);
    const campaign = await db.campaign.findUnique({
      where: { id },
      select: {
        status: true, startedAt: true, finishedAt: true, pacingPerMinute: true,
        totalTargeted: true, name: true, scheduleAt: true, propertyId: true,
      },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    assertPropertyAccess(user, campaign.propertyId);
    const minuteAgo = new Date(Date.now() - 60_000);
    const [statusCounts, clicked, sentLastMin] = await Promise.all([
      db.send.groupBy({ by: ["status"], where: { campaignId: id }, _count: { status: true } }),
      db.send.count({ where: { campaignId: id, clicked: true } }),
      db.send.count({ where: { campaignId: id, status: "sent", sentAt: { gte: minuteAgo } } }),
    ]);
    const map = Object.fromEntries(statusCounts.map((c) => [c.status, c._count.status]));
    const queued = map.queued ?? 0;
    const sent = map.sent ?? 0;
    const elapsedSec = campaign.startedAt
      ? Math.round(((campaign.finishedAt ?? new Date()).getTime() - campaign.startedAt.getTime()) / 1000)
      : 0;
    return {
      name: campaign.name,
      status: campaign.status,
      startedAt: campaign.startedAt,
      scheduleAt: campaign.scheduleAt,
      pacingPerMinute: campaign.pacingPerMinute,
      targeted: campaign.totalTargeted ?? 0,
      queued,
      sent,
      failed: map.failed ?? 0,
      expired: map.expired ?? 0,
      clicked,
      ctr: sent > 0 ? +((clicked / sent) * 100).toFixed(2) : null,
      sentLastMin,
      elapsedSec,
      etaMinutes: queued > 0 ? Math.ceil(queued / Math.max(sentLastMin, 1)) : 0,
    };
  }

  /** Live audience size for a set of segments with dedup (union). */
  @Post("audience-count")
  async audienceCount(
    @CurrentUser() user: AuthUser,
    @Body() body: { propertyId: string; segmentIds?: string[]; targetAll?: boolean },
  ) {
    const db = this.db(user);
    if (!body.segmentIds?.length) {
      if (!body.targetAll) return { count: 0 }; // none means none
      const count = await db.subscriber.count({
        where: { propertyId: body.propertyId, status: "active" },
      });
      return { count };
    }
    const segments = await db.segment.findMany({ where: { id: { in: body.segmentIds } } });
    const { segmentAudienceWhere } = await import("../segments/segment-compiler");
    const ors = segments.map((s) => segmentAudienceWhere(s.criteria as any));
    const count = await db.subscriber.count({
      where: { propertyId: body.propertyId, status: "active", OR: ors },
    });
    return { count };
  }

  @Post(":id/cancel")
  async cancel(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (campaign.status !== "scheduled") {
      throw new BadRequestException("Only scheduled campaigns can be cancelled");
    }
    this.runner.cancelSchedule(id);
    await this.db(user).campaign.update({
      where: { id },
      data: { status: "cancelled", scheduleAt: null },
    });
    await this.audit(user, "campaign.cancel", id);
    return { ok: true };
  }

  /** Send to a single subscriber for preview/testing. */
  @Post(":id/test-send")
  async testSend(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TestSendDto,
  ) {
    const db = this.db(user);
    const campaign = await db.campaign.findUnique({
      where: { id },
      include: { property: true },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    const subscriber = await db.subscriber.findUnique({ where: { id: dto.subscriber_id } });
    if (!subscriber) throw new NotFoundException("Subscriber not found");

    const send = await db.send.create({
      data: {
        id: randomUUID(),
        tenantId: user.tenantId,
        campaignId: campaign.id,
        subscriberId: subscriber.id,
        status: "queued",
      },
    });
    try {
      await this.push.send(subscriber, {
        title: campaign.title,
        body: campaign.body,
        icon: campaign.iconUrl ?? campaign.property.iconUrl,
        image: campaign.imageUrl,
        url: campaign.clickUrl,
        send_id: send.id,
        actions: (campaign.actions as any) ?? undefined,
      });
      await db.send.update({
        where: { id: send.id },
        data: { status: "sent", sentAt: new Date() },
      });
      return { ok: true, send_id: send.id };
    } catch (e) {
      const code = e instanceof PushError ? e.statusCode : null;
      await db.send.update({
        where: { id: send.id },
        data: { status: "failed", errorCode: code ? String(code) : "error" },
      });
      throw new BadRequestException(
        `Test send failed${code ? ` (push service returned ${code})` : ""}`,
      );
    }
  }

  /**
   * CDR (Call/Contact Detail Records): one billing record per lead pushed,
   * with pay-per-send + pay-per-click costs from the tenant's rates.
   */
  @Get(":id/cdr")
  async cdr(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("page") page = "1",
    @Query("page_size") pageSize = "50",
  ) {
    const db = this.db(user);
    const campaign = await db.campaign.findUnique({ where: { id }, select: { id: true, propertyId: true } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    assertPropertyAccess(user, campaign.propertyId);
    const tenant = await db.tenant.findUnique({
      where: { id: user.tenantId },
      select: { billingRates: true },
    });
    const rates = normalizeRates(tenant?.billingRates);

    const take = Math.min(Math.max(Number(pageSize) || 50, 1), 500);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [rows, total, sentCount, clickCount] = await Promise.all([
      db.send.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: "asc" },
        skip,
        take,
        select: {
          id: true, status: true, variant: true, clicked: true,
          errorCode: true, createdAt: true, sentAt: true, clickedAt: true,
          subscriber: { select: { id: true, utmCampaign: true, device: true, country: true } },
        },
      }),
      db.send.count({ where: { campaignId: id } }),
      db.send.count({ where: { campaignId: id, status: "sent" } }),
      db.send.count({ where: { campaignId: id, clicked: true } }),
    ]);

    return {
      rates,
      summary: {
        records: total,
        sent: sentCount,
        clicked: clickCount,
        sendCost: +(sentCount * rates.per_send).toFixed(2),
        clickCost: +(clickCount * rates.per_click).toFixed(2),
        total: +(sentCount * rates.per_send + clickCount * rates.per_click).toFixed(2),
      },
      rows: rows.map((r) => ({
        id: r.id,
        at: r.sentAt ?? r.createdAt,
        status: r.status,
        variant: r.variant,
        clicked: r.clicked,
        clickedAt: r.clickedAt,
        errorCode: r.errorCode,
        lead: r.subscriber,
        cost: +(
          (r.status === "sent" ? rates.per_send : 0) + (r.clicked ? rates.per_click : 0)
        ).toFixed(4),
      })),
      total,
      page: Number(page) || 1,
      pageSize: take,
    };
  }

  @Get(":id/report")
  async report(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.db(user);
    const campaign = await db.campaign.findUnique({
      where: { id },
      include: { segment: { select: { name: true } } },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    assertPropertyAccess(user, campaign.propertyId);

    const [statusCounts, errorCounts, clicked, variantSent, variantClicked, revenue] =
      await Promise.all([
        db.send.groupBy({ by: ["status"], where: { campaignId: id }, _count: { status: true } }),
        db.send.groupBy({
          by: ["errorCode"],
          where: { campaignId: id, errorCode: { not: null } },
          _count: { errorCode: true },
        }),
        db.send.count({ where: { campaignId: id, clicked: true } }),
        db.send.groupBy({
          by: ["variant"],
          where: { campaignId: id, variant: { not: null }, status: "sent" },
          _count: { variant: true },
        }),
        db.send.groupBy({
          by: ["variant"],
          where: { campaignId: id, variant: { not: null }, clicked: true },
          _count: { variant: true },
        }),
        db.conversion.aggregate({
          where: { campaignId: id },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);

    const statuses = Object.fromEntries(statusCounts.map((c) => [c.status, c._count.status]));
    const sent = statuses.sent ?? 0;

    const clicksByVariant = new Map(variantClicked.map((v) => [v.variant, v._count.variant]));
    const variants = variantSent.map((v) => {
      const vClicked = clicksByVariant.get(v.variant) ?? 0;
      return {
        variant: v.variant,
        sent: v._count.variant,
        clicked: vClicked,
        ctr: v._count.variant > 0 ? +((vClicked / v._count.variant) * 100).toFixed(2) : 0,
      };
    }).sort((a, b) => (a.variant! < b.variant! ? -1 : 1));

    return {
      campaign,
      funnel: {
        targeted: campaign.totalTargeted ?? 0,
        queued: statuses.queued ?? 0,
        sent,
        delivered: sent,
        clicked,
        failed: statuses.failed ?? 0,
        expired: statuses.expired ?? 0,
      },
      ctr: sent > 0 ? +((clicked / sent) * 100).toFixed(2) : null,
      errors: errorCounts.map((e) => ({ code: e.errorCode, count: e._count.errorCode })),
      variants: variants.length > 0 ? variants : null,
      revenue: {
        conversions: revenue._count._all,
        amount: Number(revenue._sum.amount ?? 0),
      },
    };
  }

  private async audit(user: AuthUser, action: string, entityId: string) {
    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action,
        entityType: "campaign",
        entityId,
      },
    });
  }
}
