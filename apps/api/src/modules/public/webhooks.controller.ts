import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { IsNumber, IsOptional, IsString, IsUUID, Min } from "class-validator";
import { PrismaService } from "../../infra/prisma.service";
import { hashApiKey } from "../../common/crypto";
import { PublicService } from "./public.service";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit.guard";

class WebhookConversionDto {
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

/**
 * Server-to-server endpoints authenticated with a property API key
 * (X-Api-Key). Used by e-commerce backends to report revenue.
 */
@Controller("webhooks")
@UseGuards(RateLimitGuard)
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly service: PublicService,
  ) {}

  @Post("conversion")
  @HttpCode(200)
  @RateLimit({ limit: 300, windowSec: 60 })
  async conversion(@Body() dto: WebhookConversionDto, @Headers("x-api-key") apiKey?: string) {
    if (!apiKey) throw new UnauthorizedException("X-Api-Key header required");
    const property = await this.prisma.system.property.findFirst({
      where: { apiKeyHash: hashApiKey(apiKey), status: "active" },
    });
    if (!property) throw new UnauthorizedException("Invalid API key");
    return this.service.trackConversion({
      tenantId: property.tenantId,
      propertyId: property.id,
      send_id: dto.send_id,
      amount: Number(dto.amount),
      currency: dto.currency,
      order_id: dto.order_id,
      source: "webhook",
    });
  }
}
