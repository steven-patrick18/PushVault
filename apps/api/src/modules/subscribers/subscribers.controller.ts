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
import { assertPropertyAccess, AuthUser, CurrentUser, JwtAuthGuard, propertyScope } from "../../common/auth.guard";
import {
  SubscriberFilterParams,
  buildSubscriberWhere,
} from "../../common/subscriber-filters";

@Controller("subscribers")
@UseGuards(JwtAuthGuard)
export class SubscribersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: SubscriberFilterParams & { page?: string; page_size?: string },
  ) {
    const where: any = { ...buildSubscriberWhere(query), ...propertyScope(user) };
    const take = Math.min(Math.max(Number(query.page_size) || 25, 1), 100);
    const skip = (Math.max(Number(query.page) || 1, 1) - 1) * take;

    // status totals honor every filter EXCEPT status itself
    const totalsWhere: any = { ...where };
    delete totalsWhere.status;

    const db = this.prisma.forTenant(user.tenantId);
    const [rows, total, statusTotals] = await Promise.all([
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
          lastPushAt: true,
          subscribedAt: true,
          unsubscribedAt: true,
          updatedAt: true,
        },
      }),
      db.subscriber.count({ where }),
      db.subscriber.groupBy({
        by: ["status"],
        where: totalsWhere,
        _count: { status: true },
      }),
    ]);

    const totals: Record<string, number> = { active: 0, unsubscribed: 0, expired: 0 };
    for (const t of statusTotals) totals[t.status] = t._count.status;

    return {
      rows: rows.map((r) => ({
        ...r,
        // when the status happened: unsubscribed → explicit; expired → last row change
        statusAt:
          r.status === "unsubscribed"
            ? r.unsubscribedAt
            : r.status === "expired"
              ? r.updatedAt
              : r.subscribedAt,
      })),
      total,
      totals,
      page: Number(query.page) || 1,
      pageSize: take,
    };
  }

  /** Distinct values for the filter dropdowns. */
  @Get("facets")
  async facets(@CurrentUser() user: AuthUser, @Query("property_id") propertyId?: string) {
    if (propertyId) assertPropertyAccess(user, propertyId);
    const db = this.prisma.forTenant(user.tenantId);
    // client scope spread LAST so property_id can't override it
    const base: any = { ...(propertyId ? { propertyId } : {}), ...propertyScope(user) };

    const distinct = async (field: string) => {
      const rows = await db.subscriber.groupBy({
        by: [field as any],
        where: { ...base, [field]: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { [field]: "desc" } } as any,
        take: 50,
      });
      return rows.map((r: any) => ({ value: r[field], count: r._count._all }));
    };

    const [countries, browsers, oses, languages, timezones, campaigns] = await Promise.all([
      distinct("country"),
      distinct("browser"),
      distinct("os"),
      distinct("language"),
      distinct("timezone"),
      distinct("utmCampaign"),
    ]);
    return { countries, browsers, oses, languages, timezones, campaigns };
  }

  /** Growth stats for the overview: new subscribers per day + by campaign. */
  @Get("stats")
  async stats(@CurrentUser() user: AuthUser, @Query("property_id") propertyId?: string) {
    if (propertyId) assertPropertyAccess(user, propertyId);
    const db = this.prisma.forTenant(user.tenantId);
    const since = new Date(Date.now() - 30 * 86400_000);
    const where: any = { subscribedAt: { gte: since }, ...(propertyId ? { propertyId } : {}), ...propertyScope(user) };

    const [recent, byCampaign] = await Promise.all([
      db.subscriber.findMany({ where, select: { subscribedAt: true } }),
      db.subscriber.groupBy({
        by: ["utmCampaign"],
        where: { ...(propertyId ? { propertyId } : {}), ...propertyScope(user) },
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
