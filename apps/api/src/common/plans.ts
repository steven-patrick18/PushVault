/** Plan quotas: pushes per calendar month per tenant. null = unlimited. */
export const PLAN_QUOTAS: Record<string, number | null> = {
  internal: null,
  free: 10_000,
  pro: 100_000,
  scale: 1_000_000,
};

export const PLAN_LABELS: Record<string, string> = {
  internal: "Internal (unlimited)",
  free: "Free — 10k pushes/mo",
  pro: "Pro — 100k pushes/mo",
  scale: "Scale — 1M pushes/mo",
};

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
