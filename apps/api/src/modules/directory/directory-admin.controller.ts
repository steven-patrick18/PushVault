import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsArray, IsBoolean, IsOptional, IsString, MinLength } from "class-validator";
import { PrismaService } from "../../infra/prisma.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}

class SiteDto {
  @IsString() @MinLength(2) name: string;
  @IsString() @MinLength(3) domain: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsString() adsenseClient?: string;
  @IsOptional() @IsString() themeColor?: string;
}

class CompanyDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) phones?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) emails?: string[];
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() hours?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsBoolean() featured?: boolean;
}

/** Directory site + company management (admins/managers). RLS-scoped by tenant. */
@Controller("directory")
@UseGuards(JwtAuthGuard)
export class DirectoryAdminController {
  constructor(private readonly prisma: PrismaService) {}

  private assertStaff(user: AuthUser) {
    if (user.role !== "admin" && user.role !== "manager") {
      throw new ForbiddenException("Only admins and managers manage directory sites");
    }
  }
  private db(user: AuthUser) {
    return this.prisma.forTenant(user.tenantId);
  }
  private norm(d: string) {
    return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }

  @Get("sites")
  async sites(@CurrentUser() user: AuthUser) {
    this.assertStaff(user);
    const rows = await this.db(user).directorySite.findMany({ orderBy: { createdAt: "asc" } });
    const counts = await this.db(user).directoryCompany.groupBy({ by: ["siteId"], _count: { siteId: true } });
    const cmap = new Map(counts.map((c) => [c.siteId, c._count.siteId]));
    return rows.map((s) => ({ ...s, companyCount: cmap.get(s.id) ?? 0 }));
  }

  @Post("sites")
  async createSite(@CurrentUser() user: AuthUser, @Body() dto: SiteDto) {
    this.assertStaff(user);
    return this.db(user).directorySite.create({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        domain: this.norm(dto.domain),
        tagline: dto.tagline ?? null,
        adsenseClient: dto.adsenseClient?.trim() || null,
        themeColor: dto.themeColor || "#7C3AED",
      },
    });
  }

  @Patch("sites/:id")
  async updateSite(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: Partial<SiteDto>) {
    this.assertStaff(user);
    const data: any = { ...dto };
    if (dto.domain) data.domain = this.norm(dto.domain);
    if (dto.adsenseClient !== undefined) data.adsenseClient = dto.adsenseClient?.trim() || null;
    return this.db(user).directorySite.update({ where: { id }, data });
  }

  @Delete("sites/:id")
  async deleteSite(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    this.assertStaff(user);
    await this.db(user).directorySite.delete({ where: { id } });
    return { ok: true };
  }

  @Get("sites/:id/companies")
  async companies(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    this.assertStaff(user);
    return this.db(user).directoryCompany.findMany({ where: { siteId: id }, orderBy: { name: "asc" } });
  }

  @Post("sites/:id/companies")
  async addCompany(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CompanyDto) {
    this.assertStaff(user);
    const site = await this.db(user).directorySite.findUnique({ where: { id } });
    if (!site) throw new NotFoundException("Site not found");
    let slug = slugify(dto.name);
    // ensure unique slug within the site
    for (let i = 2; await this.db(user).directoryCompany.findUnique({ where: { siteId_slug: { siteId: id, slug } } }); i++) {
      slug = slugify(dto.name) + "-" + i;
    }
    return this.db(user).directoryCompany.create({
      data: {
        siteId: id,
        slug,
        name: dto.name,
        category: dto.category?.trim() || "Other",
        phones: (dto.phones ?? []).map((p) => p.trim()).filter(Boolean),
        emails: (dto.emails ?? []).map((e) => e.trim()).filter(Boolean),
        website: dto.website?.trim() || null,
        hours: dto.hours?.trim() || null,
        content: dto.content?.trim() || null,
        featured: Boolean(dto.featured),
      },
    });
  }

  @Patch("companies/:id")
  async updateCompany(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CompanyDto) {
    this.assertStaff(user);
    const data: any = {};
    for (const k of ["name", "category", "website", "hours", "content", "featured"] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.phones) data.phones = dto.phones.map((p) => p.trim()).filter(Boolean);
    if (dto.emails) data.emails = dto.emails.map((e) => e.trim()).filter(Boolean);
    return this.db(user).directoryCompany.update({ where: { id }, data });
  }

  @Delete("companies/:id")
  async deleteCompany(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    this.assertStaff(user);
    await this.db(user).directoryCompany.delete({ where: { id } });
    return { ok: true };
  }
}
