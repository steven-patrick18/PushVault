import { Controller, Get, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  async overview(@CurrentUser() user: AuthUser) {
    const db = this.prisma.forTenant(user.tenantId);
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const [properties, activeSubs, newSubs30d, campaigns] = await Promise.all([
      db.property.count(),
      db.subscriber.count({ where: { status: "active" } }),
      db.subscriber.count({ where: { subscribedAt: { gte: since30d } } }),
      db.campaign.findMany({
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
    ]);

    return {
      properties,
      activeSubscribers: activeSubs,
      newSubscribers30d: newSubs30d,
      recentCampaigns: campaigns.map((c) => ({
        ...c,
        ctr: c.totalSent > 0 ? +((c.totalClicked / c.totalSent) * 100).toFixed(1) : null,
      })),
    };
  }
}
