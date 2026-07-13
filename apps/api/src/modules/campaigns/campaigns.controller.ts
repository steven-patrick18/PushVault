import {
  BadRequestException,
  Body,
  Controller,
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
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";
import { CampaignRunnerService } from "./campaign-runner.service";
import { PushService, PushError } from "./push.service";

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
  @IsInt()
  @Min(1)
  pacingPerMinute?: number;
}

class UpdateCampaignDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() clickUrl?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsArray() actions?: unknown[];
  // null = unassign segment (target all active subscribers)
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() segmentId?: string | null;
  // null = full speed
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) pacingPerMinute?: number | null;
}

class ScheduleDto {
  @IsDateString()
  schedule_at: string;
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
      where: propertyId ? { propertyId } : undefined,
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
        iconUrl: dto.iconUrl ?? null,
        imageUrl: dto.imageUrl ?? null,
        actions: (dto.actions as any) ?? undefined,
        segmentId: dto.segmentId ?? null,
        pacingPerMinute: dto.pacingPerMinute ?? null,
      },
    });
    await this.audit(user, "campaign.create", campaign.id);
    return campaign;
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    const existing = await this.db(user).campaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Campaign not found");
    if (!["draft", "scheduled"].includes(existing.status)) {
      throw new BadRequestException("Only draft or scheduled campaigns can be edited");
    }
    return this.db(user).campaign.update({ where: { id }, data: dto as any });
  }

  @Post(":id/send-now")
  async sendNow(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    await this.audit(user, "campaign.send", id);
    // dispatch runs async; the dashboard polls the report for progress
    void this.runner.dispatch(id);
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
    const campaign = await this.db(user).campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (!["draft", "scheduled"].includes(campaign.status)) {
      throw new BadRequestException(`Campaign is ${campaign.status}`);
    }
    await this.db(user).campaign.update({
      where: { id },
      data: { status: "scheduled", scheduleAt: at },
    });
    this.runner.armSchedule(id, at);
    await this.audit(user, "campaign.schedule", id);
    return { ok: true, schedule_at: at.toISOString() };
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

  @Get(":id/report")
  async report(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.db(user);
    const campaign = await db.campaign.findUnique({
      where: { id },
      include: { segment: { select: { name: true } } },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const [statusCounts, errorCounts, clicked] = await Promise.all([
      db.send.groupBy({ by: ["status"], where: { campaignId: id }, _count: { status: true } }),
      db.send.groupBy({
        by: ["errorCode"],
        where: { campaignId: id, errorCode: { not: null } },
        _count: { errorCode: true },
      }),
      db.send.count({ where: { campaignId: id, clicked: true } }),
    ]);

    const statuses = Object.fromEntries(statusCounts.map((c) => [c.status, c._count.status]));
    const sent = statuses.sent ?? 0;
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
