import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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

  @Post(":id/rotate-api-key")
  rotate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.properties.rotateApiKey(user, id);
  }
}
