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
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";
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
      where: propertyId ? { propertyId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSegmentDto) {
    compileCriteria(dto.criteria); // validate before saving
    return this.db(user).segment.create({
      data: {
        tenantId: user.tenantId,
        propertyId: dto.propertyId,
        name: dto.name,
        criteria: dto.criteria as any,
        isDynamic: dto.isDynamic ?? true,
      },
    });
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    if (dto.criteria) compileCriteria(dto.criteria);
    return this.db(user).segment.update({
      where: { id },
      data: { name: dto.name, criteria: dto.criteria as any },
    });
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.db(user).segment.delete({ where: { id } });
    return { ok: true };
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
