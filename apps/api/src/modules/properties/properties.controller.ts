import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";
import { PropertiesService } from "./properties.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";

class CreatePropertyDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  domains: string[];

  @IsOptional()
  @IsString()
  iconUrl?: string;
}

class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domains?: string[];

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  promptConfig?: unknown;

  @IsOptional()
  @IsString()
  callDomain?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  frequencyCapPerDay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  frequencyCapPerWeek?: number;
}

@Controller("properties")
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.properties.list(user);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto) {
    return this.properties.create(user, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.properties.update(user, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.remove(user, id);
  }

  @Post(":id/rotate-api-key")
  rotate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.rotateApiKey(user, id);
  }

  @Post(":id/verify")
  verify(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.verify(user, id);
  }

  /** One-click hosted opt-in page: check DNS → register subdomain → warm cert */
  @Post(":id/hosted-domain")
  activateHostedDomain(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { domain: string },
  ) {
    return this.properties.activateHostedDomain(user, id, String(body?.domain ?? ""));
  }

  @Post(":id/generate-vapid")
  generateVapid(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.generateVapid(user, id);
  }

  @Get(":id/pages")
  pages(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.pages(user, id);
  }

  @Get(":id/auto-assign")
  autoAssign(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.getAutoAssign(user, id);
  }

  @Put(":id/auto-assign")
  setAutoAssign(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { status: "active" | "paused"; rules: { segmentId: string; weight: number }[] } | null,
  ) {
    return this.properties.setAutoAssign(user, id, body);
  }
}
