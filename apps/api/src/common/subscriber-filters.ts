/** Shared lead filters — used by the Subscribers list, facets, and segment bulk-assign. */
export interface SubscriberFilterParams {
  property_id?: string;
  status?: string;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  country?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
  language?: string;
  timezone?: string;
  from?: string;
  to?: string;
  /** 'yes' = never pushed (fresh leads), 'no' = already contacted */
  fresh?: string;
}

// Force every filter value to a plain string. Query strings parsed by qs can
// smuggle objects/arrays (e.g. ?country[not]=IN → { not: "IN" }), which would
// otherwise be spliced into the Prisma where as an operator. Non-strings and
// empty strings become undefined (ignored).
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function validDate(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export function buildSubscriberWhere(p: SubscriberFilterParams): Record<string, any> {
  const where: Record<string, any> = {};
  const propertyId = str(p.property_id);
  const status = str(p.status);
  const utmCampaign = str(p.utm_campaign);
  const utmSource = str(p.utm_source);
  const utmMedium = str(p.utm_medium);
  const country = str(p.country);
  const city = str(p.city);
  const device = str(p.device);
  const browser = str(p.browser);
  const os = str(p.os);
  const language = str(p.language);
  const timezone = str(p.timezone);
  if (propertyId) where.propertyId = propertyId;
  if (status) where.status = status;
  if (utmCampaign) where.utmCampaign = { contains: utmCampaign, mode: "insensitive" };
  if (utmSource) where.utmSource = { contains: utmSource, mode: "insensitive" };
  if (utmMedium) where.utmMedium = { contains: utmMedium, mode: "insensitive" };
  if (country) where.country = country;
  if (city) where.city = { contains: city, mode: "insensitive" };
  if (device) where.device = device;
  if (browser) where.browser = browser;
  if (os) where.os = os;
  if (language) where.language = language;
  if (timezone) where.timezone = timezone;
  const from = validDate(p.from);
  const to = validDate(p.to);
  if (from || to) {
    where.subscribedAt = {};
    if (from) where.subscribedAt.gte = from;
    if (to) where.subscribedAt.lte = to;
  }
  if (str(p.fresh) === "yes") where.pushesReceived = 0;
  if (str(p.fresh) === "no") where.pushesReceived = { gt: 0 };
  return where;
}
