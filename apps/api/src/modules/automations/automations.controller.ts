import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard, propertyScope } from "../../common/auth.guard";
import { AutomationStep } from "./automations.service";

class CreateAutomationDto {
  @IsUUID()
  propertyId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsArray()
  steps: AutomationStep[];
}

class UpdateAutomationDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsArray() steps?: AutomationStep[];
  @IsOptional() @IsIn(["active", "paused"]) status?: string;
}

function validateSteps(steps: AutomationStep[]) {
  if (!steps.length) throw new BadRequestException("At least one step is required");
  if (steps.length > 10) throw new BadRequestException("Max 10 steps");
  for (const s of steps) {
    if (typeof s.delay_minutes !== "number" || s.delay_minutes < 0) {
      throw new BadRequestException("Each step needs delay_minutes >= 0");
    }
    if (!s.title || !s.body || !s.click_url) {
      throw new BadRequestException("Each step needs title, body and click_url");
    }
  }
}

@Controller("automations")
@UseGuards(JwtAuthGuard)
export class AutomationsController {
  constructor(private readonly prisma: PrismaService) {}

  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query("property_id") propertyId?: string) {
    const automations = await this.db(user).automation.findMany({
      where: { ...propertyScope(user), ...(propertyId ? { propertyId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    // enrich with job stats
    const stats = await this.db(user).automationJob.groupBy({
      by: ["automationId", "status"],
      where: { automationId: { in: automations.map((a) => a.id) } },
      _count: { _all: true },
    });
    const byAutomation = new Map<string, Record<string, number>>();
    for (const s of stats) {
      const entry = byAutomation.get(s.automationId) ?? {};
      entry[s.status] = s._count._all;
      byAutomation.set(s.automationId, entry);
    }
    return automations.map((a) => ({ ...a, jobStats: byAutomation.get(a.id) ?? {} }));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateAutomationDto) {
    validateSteps(dto.steps);
    const automation = await this.db(user).automation.create({
      data: {
        tenantId: user.tenantId,
        propertyId: dto.propertyId,
        name: dto.name,
        steps: dto.steps as any,
      },
    });
    await this.audit(user, "automation.create", automation.id);
    return automation;
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationDto,
  ) {
    if (dto.steps) validateSteps(dto.steps);
    const automation = await this.db(user).automation.update({
      where: { id },
      data: { name: dto.name, steps: dto.steps as any, status: dto.status },
    });
    await this.audit(user, "automation.update", id);
    return automation;
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.db(user).automation.delete({ where: { id } });
    await this.audit(user, "automation.delete", id);
    return { ok: true };
  }

  private async audit(user: AuthUser, action: string, entityId: string) {
    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action,
        entityType: "automation",
        entityId,
      },
    });
  }
}
