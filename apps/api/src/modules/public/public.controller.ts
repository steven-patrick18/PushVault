import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
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
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 60, windowSec: 60 })
  promptConfig(
    @Query("property_key") propertyKey: string,
    @Ip() ip: string,
    @Headers("origin") origin?: string,
  ) {
    return this.service.getPromptConfig(propertyKey, origin, ip);
  }

  /**
   * Caddy on-demand-TLS gate: only issue a certificate for a host that is a
   * registered active property domain (prevents anyone pointing DNS at us and
   * minting certs). Returns 200 to approve, 404 to refuse.
   */
  @Get("tls-check")
  @RateLimit({ limit: 300, windowSec: 60 })
  async tlsCheck(@Query("domain") domain: string, @Res() res: Response) {
    const property = await this.service.propertyByHost(domain);
    res.status(property ? 200 : 404).send(property ? "ok" : "no");
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
  @RateLimit({ limit: 60, windowSec: 60 })
  async call(
    @Query("n") n: string,
    @Query("sid") sid: string | undefined,
    @Query("pv_sid") pvSid: string | undefined,
    @Res() res: Response,
  ) {
    const number = String(n ?? "").replace(/[^\d+]/g, "");
    const clickId = sid || pvSid;
    // only dial a number that belongs to the referenced send's campaign — an
    // arbitrary ?n= (e.g. a premium-rate number) is refused, not auto-dialed
    const allowed = await this.service.callNumberAllowed(number, clickId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (!allowed) {
      return res.status(400).send(`<!doctype html><meta charset="utf-8">
<title>Link not valid</title>
<body style="font-family:system-ui,sans-serif;background:#0e0e13;color:#e8e8f0;text-align:center;padding-top:80px">
<div style="font-size:44px">🔒</div>
<h2>This call link is not valid</h2>
<p style="color:#9a9aad">Please tap the notification from the original message.</p></body>`);
    }
    // record the click (idempotent) so a direct/iOS open still counts
    if (clickId) this.service.trackClick(clickId).catch(() => undefined);
    const tel = "tel:" + number;
    const safe = number;
    return res.send(`<!doctype html><html><head><meta charset="utf-8">
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
