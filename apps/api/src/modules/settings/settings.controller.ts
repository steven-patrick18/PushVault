import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";
import { hashSecret } from "../../common/crypto";
import { PLAN_LABELS, PLAN_QUOTAS, monthStart, nextMonthStart } from "../../common/plans";

class UpdateTenantDto {
  @IsOptional() @IsString() brandName?: string;
  @IsOptional() @IsString() brandLogoUrl?: string;
  @IsOptional() @IsString() brandPrimaryColor?: string;
  @IsOptional() @IsIn(["internal", "free", "pro", "scale"]) plan?: string;
  // pay-per-use rates: {per_send, per_click, currency}
  @IsOptional() billingRates?: { per_send?: number; per_click?: number; currency?: string };
}

export function normalizeRates(raw: any): { per_send: number; per_click: number; currency: string } {
  return {
    per_send: Math.max(0, Number(raw?.per_send) || 0),
    per_click: Math.max(0, Number(raw?.per_click) || 0),
    currency: (raw?.currency ?? "INR").toString().toUpperCase().slice(0, 3),
  };
}

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsIn(["admin", "manager", "operator", "client"])
  role: "admin" | "manager" | "operator" | "client";

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  propertyIds?: string[];
}

@Controller()
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  /** These endpoints expose the staff roster, financials and audit trail. */
  private assertStaff(user: AuthUser) {
    if (user.role !== "admin" && user.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can access workspace settings");
    }
  }

  @Get("tenant")
  tenant(@CurrentUser() user: AuthUser) {
    this.assertStaff(user);
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
    this.assertStaff(user);
    // plan + billing rates control quota and money — admins only
    if ((dto.plan !== undefined || dto.billingRates !== undefined) && user.role !== "admin") {
      throw new ForbiddenException("Only admins can change the plan or billing rates");
    }
    const db = this.prisma.forTenant(user.tenantId);
    const data: any = { ...dto };
    if (dto.billingRates !== undefined) data.billingRates = normalizeRates(dto.billingRates);
    const tenant = await db.tenant.update({
      where: { id: user.tenantId },
      data,
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
    this.assertStaff(user);
    return this.prisma.forTenant(user.tenantId).user.findMany({
      select: { id: true, email: true, role: true, propertyIds: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  @Post("users")
  async createUser(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    if (user.role !== "admin") throw new ForbiddenException("Only admins can create users");
    if (dto.role === "client" && !dto.propertyIds?.length) {
      throw new BadRequestException("Client users need at least one property assigned");
    }
    const db = this.prisma.forTenant(user.tenantId);
    const created = await db.user.create({
      data: {
        tenantId: user.tenantId,
        email: dto.email.toLowerCase().trim(),
        passwordHash: hashSecret(dto.password),
        role: dto.role,
        propertyIds: dto.role === "client" ? (dto.propertyIds ?? []) : [],
      },
      select: { id: true, email: true, role: true, propertyIds: true },
    });
    await db.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "user.create",
        entityType: "user",
        entityId: created.id,
        after: { email: created.email, role: created.role } as any,
      },
    });
    return created;
  }

  @Delete("users/:id")
  async deleteUser(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    if (user.role !== "admin") throw new ForbiddenException("Only admins can remove users");
    if (id === user.userId) throw new BadRequestException("You cannot remove yourself");
    const db = this.prisma.forTenant(user.tenantId);
    await db.user.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "user.delete",
        entityType: "user",
        entityId: id,
      },
    });
    return { ok: true };
  }

  /** Billing: plan, quota, current-month usage and pay-per-use spend. */
  @Get("billing")
  async billing(@CurrentUser() user: AuthUser) {
    this.assertStaff(user);
    const db = this.prisma.forTenant(user.tenantId);
    const tenant = await db.tenant.findUnique({
      where: { id: user.tenantId },
      select: { plan: true, billingRates: true },
    });
    const plan = tenant?.plan ?? "internal";
    const quota = PLAN_QUOTAS[plan] ?? null;
    const rates = normalizeRates(tenant?.billingRates);
    const [used, sentMonth, clickedMonth] = await Promise.all([
      db.send.count({ where: { createdAt: { gte: monthStart() } } }),
      db.send.count({ where: { createdAt: { gte: monthStart() }, status: "sent" } }),
      db.send.count({ where: { createdAt: { gte: monthStart() }, clicked: true } }),
    ]);
    return {
      rates,
      spend: {
        sent: sentMonth,
        clicked: clickedMonth,
        sendCost: +(sentMonth * rates.per_send).toFixed(2),
        clickCost: +(clickedMonth * rates.per_click).toFixed(2),
        total: +(sentMonth * rates.per_send + clickedMonth * rates.per_click).toFixed(2),
      },
      plan,
      planLabel: PLAN_LABELS[plan] ?? plan,
      quota,
      used,
      remaining: quota === null ? null : Math.max(0, quota - used),
      resetsAt: nextMonthStart().toISOString(),
      plans: Object.entries(PLAN_LABELS).map(([key, label]) => ({
        key,
        label,
        quota: PLAN_QUOTAS[key],
      })),
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    };
  }

  @Get("audit")
  async audit(@CurrentUser() user: AuthUser) {
    this.assertStaff(user);
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
