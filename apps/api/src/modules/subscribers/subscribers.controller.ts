import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard, propertyScope } from "../../common/auth.guard";

@Controller("subscribers")
@UseGuards(JwtAuthGuard)
export class SubscribersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query("property_id") propertyId?: string,
    @Query("status") status?: string,
    @Query("utm_campaign") utmCampaign?: string,
    @Query("country") country?: string,
    @Query("device") device?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page = "1",
    @Query("page_size") pageSize = "25",
  ) {
    const where: any = { ...propertyScope(user) };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (utmCampaign) where.utmCampaign = utmCampaign;
    if (country) where.country = country;
    if (device) where.device = device;
    if (from || to) {
      where.subscribedAt = {};
      if (from) where.subscribedAt.gte = new Date(from);
      if (to) where.subscribedAt.lte = new Date(to);
    }

    const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const db = this.prisma.forTenant(user.tenantId);
    const [rows, total] = await Promise.all([
      db.subscriber.findMany({
        where,
        orderBy: { subscribedAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          propertyId: true,
          endpoint: true,
          status: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          landingUrl: true,
          country: true,
          region: true,
          city: true,
          device: true,
          browser: true,
          os: true,
          language: true,
          timezone: true,
          pushesReceived: true,
          pushesClicked: true,
          subscribedAt: true,
        },
      }),
      db.subscriber.count({ where }),
    ]);

    return { rows, total, page: Number(page), pageSize: take };
  }

  /** Growth stats for the overview: new subscribers per day + by campaign. */
  @Get("stats")
  async stats(@CurrentUser() user: AuthUser, @Query("property_id") propertyId?: string) {
    const db = this.prisma.forTenant(user.tenantId);
    const since = new Date(Date.now() - 30 * 86400_000);
    const where: any = { subscribedAt: { gte: since }, ...propertyScope(user) };
    if (propertyId) where.propertyId = propertyId;

    const [recent, byCampaign] = await Promise.all([
      db.subscriber.findMany({ where, select: { subscribedAt: true } }),
      db.subscriber.groupBy({
        by: ["utmCampaign"],
        where: { ...propertyScope(user), ...(propertyId ? { propertyId } : {}) },
        _count: { _all: true },
        orderBy: { _count: { utmCampaign: "desc" } },
        take: 8,
      }),
    ]);

    const days: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      days.push({ date: d.toISOString().slice(0, 10), count: 0 });
    }
    const index = new Map(days.map((d, i) => [d.date, i]));
    for (const s of recent) {
      const key = s.subscribedAt.toISOString().slice(0, 10);
      const i = index.get(key);
      if (i !== undefined) days[i].count++;
    }

    return {
      byDay: days,
      byCampaign: byCampaign.map((c) => ({
        campaign: c.utmCampaign ?? "(direct)",
        count: c._count._all,
      })),
    };
  }

  /** GDPR/DPDP erasure: hard-delete subscriber (sends cascade). */
  @Delete(":id")
  async erase(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.prisma.forTenant(user.tenantId);
    await db.subscriber.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "subscriber.erase",
        entityType: "subscriber",
        entityId: id,
      },
    });
    return { ok: true };
  }
}
