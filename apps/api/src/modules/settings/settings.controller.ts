import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";

class UpdateTenantDto {
  @IsOptional() @IsString() brandName?: string;
  @IsOptional() @IsString() brandLogoUrl?: string;
  @IsOptional() @IsString() brandPrimaryColor?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("tenant")
  tenant(@CurrentUser() user: AuthUser) {
    return this.prisma.forTenant(user.tenantId).tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        id: true,
        name: true,
        brandName: true,
        brandLogoUrl: true,
        brandPrimaryColor: true,
        plan: true,
        createdAt: true,
      },
    });
  }

  @Patch("tenant")
  async updateTenant(@CurrentUser() user: AuthUser, @Body() dto: UpdateTenantDto) {
    const db = this.prisma.forTenant(user.tenantId);
    const tenant = await db.tenant.update({
      where: { id: user.tenantId },
      data: dto,
      select: { id: true, name: true, brandName: true, brandLogoUrl: true, brandPrimaryColor: true },
    });
    await db.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "tenant.update_branding",
        entityType: "tenant",
        entityId: user.tenantId,
        after: dto as any,
      },
    });
    return tenant;
  }

  @Get("users")
  users(@CurrentUser() user: AuthUser) {
    return this.prisma.forTenant(user.tenantId).user.findMany({
      select: { id: true, email: true, role: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  @Get("audit")
  async audit(@CurrentUser() user: AuthUser) {
    const db = this.prisma.forTenant(user.tenantId);
    const [rows, users] = await Promise.all([
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.user.findMany({ select: { id: true, email: true } }),
    ]);
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      user: r.userId ? (emailById.get(r.userId) ?? "unknown") : "system",
      at: r.createdAt,
    }));
  }
}
