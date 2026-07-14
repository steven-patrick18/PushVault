import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { IsArray, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { GoogleAdsService } from "./google-ads.service";
import {
  assertPropertyAccess,
  AuthUser,
  CurrentUser,
  JwtAuthGuard,
} from "../../common/auth.guard";

class ConfigDto {
  @IsOptional() @IsString() developerToken?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsString() refreshToken?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() loginCustomerId?: string;
  @IsOptional() @IsString() apiVersion?: string;
}

class CreateCampaignDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsNumber()
  @Min(0.5)
  dailyBudget: number;

  @IsOptional()
  @IsString()
  finalUrl?: string;

  @IsArray()
  @IsString({ each: true })
  headlines: string[];

  @IsArray()
  @IsString({ each: true })
  descriptions: string[];

  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  cpcBid?: number;
}

/** Credentials are tenant secrets: admins and managers only. */
function assertAdsAdmin(user: AuthUser) {
  if (user.role !== "admin" && user.role !== "manager") {
    throw new ForbiddenException("Only admins and managers can manage Google Ads");
  }
}

@Controller("google-ads")
@UseGuards(JwtAuthGuard)
export class GoogleAdsController {
  constructor(private readonly ads: GoogleAdsService) {}

  @Get("config")
  config(@CurrentUser() user: AuthUser) {
    assertAdsAdmin(user);
    return this.ads.getConfig(user);
  }

  @Put("config")
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto) {
    assertAdsAdmin(user);
    return this.ads.setConfig(user, dto);
  }

  @Delete("config")
  disconnect(@CurrentUser() user: AuthUser) {
    assertAdsAdmin(user);
    return this.ads.disconnect(user);
  }

  /** "Google norms" landing-page review for a property. Any staff can run it. */
  @Post("check/:propertyId")
  check(@CurrentUser() user: AuthUser, @Param("propertyId", ParseUUIDPipe) propertyId: string) {
    assertPropertyAccess(user, propertyId);
    return this.ads.complianceCheck(user, propertyId);
  }

  @Get("campaigns")
  campaigns(@CurrentUser() user: AuthUser) {
    assertAdsAdmin(user);
    return this.ads.listCampaigns(user);
  }

  @Post("campaigns/:propertyId")
  create(
    @CurrentUser() user: AuthUser,
    @Param("propertyId", ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    assertAdsAdmin(user);
    assertPropertyAccess(user, propertyId);
    return this.ads.createCampaign(user, propertyId, dto);
  }
}
