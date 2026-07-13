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

export function buildSubscriberWhere(p: SubscriberFilterParams): Record<string, any> {
  const where: Record<string, any> = {};
  if (p.property_id) where.propertyId = p.property_id;
  if (p.status) where.status = p.status;
  if (p.utm_campaign) where.utmCampaign = { contains: p.utm_campaign, mode: "insensitive" };
  if (p.utm_source) where.utmSource = { contains: p.utm_source, mode: "insensitive" };
  if (p.utm_medium) where.utmMedium = { contains: p.utm_medium, mode: "insensitive" };
  if (p.country) where.country = p.country;
  if (p.city) where.city = { contains: p.city, mode: "insensitive" };
  if (p.device) where.device = p.device;
  if (p.browser) where.browser = p.browser;
  if (p.os) where.os = p.os;
  if (p.language) where.language = p.language;
  if (p.timezone) where.timezone = p.timezone;
  if (p.from || p.to) {
    where.subscribedAt = {};
    if (p.from) where.subscribedAt.gte = new Date(p.from);
    if (p.to) where.subscribedAt.lte = new Date(p.to);
  }
  if (p.fresh === "yes") where.pushesReceived = 0;
  if (p.fresh === "no") where.pushesReceived = { gt: 0 };
  return where;
}
