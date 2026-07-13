import {
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
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard, propertyScope } from "../../common/auth.guard";
import { compileCriteria, SegmentCriteria } from "./segment-compiler";

class CreateSegmentDto {
  @IsUUID()
  propertyId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsObject()
  criteria: SegmentCriteria;

  @IsOptional()
  @IsBoolean()
  isDynamic?: boolean;
}

class UpdateSegmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsObject()
  criteria?: SegmentCriteria;
}

@Controller("segments")
@UseGuards(JwtAuthGuard)
export class SegmentsController {
  constructor(private readonly prisma: PrismaService) {}

  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("property_id") propertyId?: string) {
    return this.db(user).segment.findMany({
      where: { ...propertyScope(user), ...(propertyId ? { propertyId } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSegmentDto) {
    compileCriteria(dto.criteria); // validate before saving
    const segment = await this.db(user).segment.create({
      data: {
        tenantId: user.tenantId,
        propertyId: dto.propertyId,
        name: dto.name,
        criteria: dto.criteria as any,
        isDynamic: dto.isDynamic ?? true,
      },
    });
    await this.audit(user, "segment.create", segment.id, null, dto.criteria);
    return segment;
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    if (dto.criteria) compileCriteria(dto.criteria);
    const before = await this.db(user).segment.findUnique({ where: { id } });
    const segment = await this.db(user).segment.update({
      where: { id },
      data: { name: dto.name, criteria: dto.criteria as any },
    });
    await this.audit(user, "segment.update", id, before?.criteria, dto.criteria);
    return segment;
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.db(user).segment.delete({ where: { id } });
    await this.audit(user, "segment.delete", id, null, null);
    return { ok: true };
  }

  private async audit(
    user: AuthUser,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.db(user).auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        action,
        entityType: "segment",
        entityId,
        before: before as any,
        after: after as any,
      },
    });
  }

  /** Evaluate the live audience size for this segment. */
  @Post(":id/count")
  async count(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.db(user);
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException("Segment not found");
    const where = compileCriteria(segment.criteria as SegmentCriteria);
    const count = await db.subscriber.count({
      where: { ...where, propertyId: segment.propertyId, status: "active" },
    });
    await db.segment.update({
      where: { id },
      data: { cachedCount: count, cachedAt: new Date() },
    });
    return { count };
  }
}
