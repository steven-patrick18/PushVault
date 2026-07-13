import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
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

  /**
   * Call bridge: an HTTPS page that launches the native dialer. Notifications
   * point here (?n=<number>&sid=<send_id>) instead of tel: directly, because
   * tel: from a service-worker notification is blocked on iOS — but tel: from
   * a *page* is honored everywhere (iPhone, Android, desktop). Auto-dials, with
   * a tap-again fallback, and records the click for CTR/CDR.
   */
  @Get("call")
  call(
    @Query("n") n: string,
    @Query("sid") sid: string | undefined,
    @Query("pv_sid") pvSid: string | undefined,
    @Res() res: Response,
  ) {
    const number = String(n ?? "").replace(/[^\d+]/g, "");
    // click is normally recorded by the SW; track here too (idempotent) so a
    // direct/iOS open still counts
    const clickId = sid || pvSid;
    if (clickId) this.service.trackClick(clickId).catch(() => undefined);
    const tel = "tel:" + number;
    const safe = number.replace(/[^\d+]/g, "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connecting your call…</title>
<style>body{font-family:system-ui,sans-serif;background:#0e0e13;color:#e8e8f0;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}
.c{max-width:340px;padding:28px}.n{font-size:22px;font-weight:700;margin:14px 0 6px}
a.btn{display:inline-block;margin-top:18px;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:700;font-size:16px}
.d{color:#9a9aad;font-size:13px;margin-top:16px}</style></head>
<body><div class="c"><div style="font-size:44px">📞</div>
<div class="n">Connecting your call…</div>
<div class="d">If the dialer doesn't open automatically, tap the button.</div>
<a class="btn" href="${tel}">Call ${safe}</a></div>
<script>
try{location.href=${JSON.stringify(tel)};}catch(e){}
setTimeout(function(){try{location.href=${JSON.stringify(tel)};}catch(e){}},600);
</script></body></html>`);
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
