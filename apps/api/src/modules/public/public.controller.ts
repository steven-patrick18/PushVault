import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Min } from "class-validator";
import { PublicService } from "./public.service";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit.guard";

class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  property_key: string;

  @IsObject()
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };

  @IsOptional()
  @IsObject()
  utm?: Record<string, string>;

  @IsOptional()
  @IsString()
  landing_url?: string;

  @IsOptional()
  @IsString()
  referrer?: string;

  @IsOptional()
  @IsString()
  tz?: string;

  @IsOptional()
  @IsString()
  lang?: string;
}

class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  property_key: string;

  @IsString()
  @IsNotEmpty()
  endpoint: string;
}

class ClickDto {
  @IsUUID()
  send_id: string;
}

class PageviewDto {
  @IsString()
  @IsNotEmpty()
  property_key: string;

  @IsString()
  @IsNotEmpty()
  path: string;
}

class ConversionDto {
  @IsString()
  @IsNotEmpty()
  property_key: string;

  @IsOptional()
  @IsUUID()
  send_id?: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  order_id?: string;
}

@Controller("public")
@UseGuards(RateLimitGuard)
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get("prompt-config")
  @RateLimit({ limit: 60, windowSec: 60 })
  promptConfig(
    @Query("property_key") propertyKey: string,
    @Headers("origin") origin?: string,
  ) {
    return this.service.getPromptConfig(propertyKey, origin);
  }

  @Post("subscribe")
  @HttpCode(201)
  @RateLimit({ limit: 10, windowSec: 60, perProperty: true })
  subscribe(
    @Body() dto: SubscribeDto,
    @Ip() ip: string,
    @Headers("origin") origin?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.service.subscribe(dto as any, origin, ip, userAgent);
  }

  @Post("unsubscribe")
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60, perProperty: true })
  unsubscribe(@Body() dto: UnsubscribeDto, @Headers("origin") origin?: string) {
    return this.service.unsubscribe(dto.property_key, dto.endpoint, origin);
  }

  @Post("event/click")
  @HttpCode(200)
  @RateLimit({ limit: 120, windowSec: 60 })
  click(@Body() dto: ClickDto) {
    return this.service.trackClick(dto.send_id);
  }

  @Post("event/pageview")
  @HttpCode(200)
  @RateLimit({ limit: 120, windowSec: 60, perProperty: true })
  pageview(@Body() dto: PageviewDto, @Headers("origin") origin?: string) {
    return this.service.trackPageview(dto.property_key, dto.path, origin);
  }

  /** Revenue pixel — called by window.PushVault.trackConversion(...) */
  @Post("event/conversion")
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60, perProperty: true })
  conversion(@Body() dto: ConversionDto, @Headers("origin") origin?: string) {
    return this.service.trackConversion(
      { ...dto, amount: Number(dto.amount), source: "pixel" },
      origin,
    );
  }
}
