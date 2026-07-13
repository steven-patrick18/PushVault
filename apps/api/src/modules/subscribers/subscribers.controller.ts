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
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";

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
    const where: any = {};
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
