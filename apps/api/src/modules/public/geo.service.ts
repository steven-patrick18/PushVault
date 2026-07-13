import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { existsSync } from "node:fs";
import maxmind, { CityResponse, Reader } from "maxmind";

export interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

/**
 * GeoIP lookup via a local MaxMind GeoLite2-City database. The mmdb file is
 * optional in dev (requires a MaxMind account to download); when absent all
 * lookups return nulls. IPs are used for the lookup and never stored (§9).
 */
@Injectable()
export class GeoService implements OnModuleInit {
  private reader: Reader<CityResponse> | null = null;
  private readonly logger = new Logger("GeoService");

  async onModuleInit() {
    const path = process.env.GEOIP_DB_PATH;
    if (path && existsSync(path)) {
      this.reader = await maxmind.open<CityResponse>(path);
      this.logger.log(`GeoLite2 database loaded from ${path}`);
    } else {
      this.logger.warn("GEOIP_DB_PATH not set or file missing — geo lookups disabled");
    }
  }

  lookup(ip: string | undefined): GeoResult {
    const empty: GeoResult = { country: null, region: null, city: null };
    if (!ip || !this.reader) return empty;
    try {
      const res = this.reader.get(ip);
      if (!res) return empty;
      return {
        country: res.country?.iso_code ?? null,
        region: res.subdivisions?.[0]?.names?.en ?? null,
        city: res.city?.names?.en ?? null,
      };
    } catch {
      return empty;
    }
  }
}
