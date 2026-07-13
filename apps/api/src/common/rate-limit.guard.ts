import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

export interface RateLimitConfig {
  limit: number;
  windowSec: number;
  /** also key the bucket by body.property_key (per-property limits, §9) */
  perProperty?: boolean;
}

export const RATE_LIMIT_KEY = "rate_limit";
export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);

/**
 * In-memory sliding-window rate limiter (per process). Honors
 * X-Forwarded-For so limits survive a reverse proxy; swap the Map for Redis
 * when running multiple API replicas.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.get<RateLimitConfig | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!config) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
    const ip = xff || req.ip || "unknown";
    const propertyKey = config.perProperty ? ((req.body as any)?.property_key ?? "") : "";
    const key = `${context.getClass().name}.${context.getHandler().name}:${ip}:${propertyKey}`;

    const now = Date.now();
    const windowMs = config.windowSec * 1000;
    const hits = (this.buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= config.limit) {
      throw new HttpException("Too many requests — slow down", 429);
    }
    hits.push(now);
    this.buckets.set(key, hits);

    // occasional cleanup so idle keys don't leak
    if (now - this.lastSweep > 60_000) {
      this.lastSweep = now;
      for (const [k, v] of this.buckets) {
        const alive = v.filter((t) => now - t < 10 * 60_000);
        if (alive.length === 0) this.buckets.delete(k);
        else this.buckets.set(k, alive);
      }
    }
    return true;
  }
}
