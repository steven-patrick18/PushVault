import { Controller, Get, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard, propertyScope } from "../../common/auth.guard";

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  async overview(@CurrentUser() user: AuthUser) {
    const db = this.prisma.forTenant(user.tenantId);
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const scope = propertyScope(user);
    const [properties, activeSubs, newSubs30d, campaigns, revenue] = await Promise.all([
      db.property.count({
        where: user.role === "client" ? { id: { in: user.propertyIds } } : undefined,
      }),
      db.subscriber.count({ where: { status: "active", ...scope } }),
      db.subscriber.count({ where: { subscribedAt: { gte: since30d }, ...scope } }),
      db.campaign.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          status: true,
          totalSent: true,
          totalClicked: true,
          finishedAt: true,
          createdAt: true,
        },
      }),
      db.conversion.aggregate({
        where: { createdAt: { gte: since30d }, ...scope },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      properties,
      activeSubscribers: activeSubs,
      newSubscribers30d: newSubs30d,
      revenue30d: Number(revenue._sum.amount ?? 0),
      conversions30d: revenue._count._all,
      recentCampaigns: campaigns.map((c) => ({
        ...c,
        ctr: c.totalSent > 0 ? +((c.totalClicked / c.totalSent) * 100).toFixed(1) : null,
      })),
    };
  }
}
