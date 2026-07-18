import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { existsSync, statSync } from "node:fs";
import maxmind, { CityResponse, Reader, Response } from "maxmind";

/** Minimal shape of a DB-IP / GeoLite2 ASN record. */
interface AsnRecord {
  autonomous_system_number?: number;
  autonomous_system_organization?: string;
}

export interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

// Known datacenter / cloud-hosting / VPN networks. Real people browse from
// residential or mobile ISPs; traffic from these ASNs is almost always a bot,
// scraper, or automation running on a rented server. Matched against the ASN
// organisation name (case-insensitive). Conservative on purpose — only names
// that are unambiguously hosting providers, not consumer ISPs.
const DATACENTER_ASN =
  /amazon|aws\b|ec2|google\s?(cloud|llc)|gcp\b|microsoft|azure|digitalocean|linode|akamai|cloudflare|fastly|ovh|hetzner|vultr|contabo|leaseweb|scaleway|hostinger|godaddy|namecheap|bluehost|dreamhost|rackspace|softlayer|ibm\s?cloud|oracle\s?cloud|alibaba|aliyun|tencent|huawei\s?cloud|choopa|quadranet|colocrossing|psychz|datacamp|m247|nforce|worldstream|serverius|hostwinds|dedipath|reliablesite|frantech|buyvm|kamatera|upcloud|clouvider|zenlayer|servers\.com|hosting|datacenter|data\s?center|colo\b|vps\b|dedicated\s?server|virtual\s?private/i;

/**
 * GeoIP lookup via local MaxMind-format databases (DB-IP Lite). Two optional
 * mmdb files: City (country/region/city) and ASN (network operator). Both are
 * optional; when absent the corresponding lookups return nulls / false. IPs are
 * used only for the lookup and never stored (§9).
 */
@Injectable()
export class GeoService implements OnModuleInit, OnModuleDestroy {
  private reader: Reader<CityResponse> | null = null;
  private asnReader: Reader<Response> | null = null;
  private cityMtime = 0;
  private asnMtime = 0;
  private reloadTimer: ReturnType<typeof setInterval> | null = null;
  private readonly logger = new Logger("GeoService");

  async onModuleInit() {
    await this.reloadIfChanged();
    // pick up monthly database refreshes (the cron just swaps the files) without
    // a restart: re-open a reader whenever its mmdb file's mtime changes.
    this.reloadTimer = setInterval(() => {
      this.reloadIfChanged().catch(() => undefined);
    }, 6 * 60 * 60 * 1000);
    if (typeof this.reloadTimer.unref === "function") this.reloadTimer.unref();
  }

  onModuleDestroy() {
    if (this.reloadTimer) clearInterval(this.reloadTimer);
  }

  /** (Re)open each mmdb reader when its file appears or is replaced. */
  private async reloadIfChanged() {
    const path = process.env.GEOIP_DB_PATH;
    if (path && existsSync(path)) {
      const m = statSync(path).mtimeMs;
      if (m !== this.cityMtime) {
        this.reader = await maxmind.open<CityResponse>(path);
        this.cityMtime = m;
        this.logger.log(`GeoLite2 database loaded from ${path}`);
      }
    } else if (!this.reader) {
      this.logger.warn("GEOIP_DB_PATH not set or file missing — geo lookups disabled");
    }

    const asnPath = process.env.GEOIP_ASN_DB_PATH;
    if (asnPath && existsSync(asnPath)) {
      const m = statSync(asnPath).mtimeMs;
      if (m !== this.asnMtime) {
        this.asnReader = await maxmind.open<Response>(asnPath);
        this.asnMtime = m;
        this.logger.log(`ASN database loaded from ${asnPath}`);
      }
    } else if (!this.asnReader) {
      this.logger.warn("GEOIP_ASN_DB_PATH not set or file missing — datacenter detection disabled");
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

  /** ASN operator name for an IP, or null if unknown / no DB. */
  asnOrg(ip: string | undefined): string | null {
    if (!ip || !this.asnReader) return null;
    try {
      const rec = this.asnReader.get(ip) as AsnRecord | null;
      return rec?.autonomous_system_organization ?? null;
    } catch {
      return null;
    }
  }

  /**
   * True when the IP belongs to a known datacenter / cloud / VPN network.
   * Fails closed to false (never blocks) when the ASN DB is missing or the org
   * is unrecognised — a real visitor is never hidden on a lookup miss.
   */
  isDatacenter(ip: string | undefined): boolean {
    const org = this.asnOrg(ip);
    return org ? DATACENTER_ASN.test(org) : false;
  }
}
