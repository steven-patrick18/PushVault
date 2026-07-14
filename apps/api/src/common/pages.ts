/**
 * The dashboard's access-controlled "pages". An admin can grant each user a
 * subset of these (User.allowedPages); an empty list means "all pages the role
 * already allows" (no extra restriction). This is a whitelist that can only
 * NARROW access — it never grants more than the role permits.
 */
export const PAGES = [
  { key: "overview", label: "Overview", path: "/" },
  { key: "properties", label: "Properties", path: "/properties" },
  { key: "subscribers", label: "Subscribers", path: "/subscribers" },
  { key: "segments", label: "Segments", path: "/segments" },
  { key: "campaigns", label: "Campaigns", path: "/campaigns" },
  { key: "automations", label: "Automations", path: "/automations" },
  { key: "updates", label: "Updates", path: "/updates" },
  { key: "troubleshoot", label: "Troubleshoot", path: "/troubleshoot" },
  { key: "settings", label: "Settings", path: "/settings" },
] as const;

export type PageKey = (typeof PAGES)[number]["key"];

export const PAGE_KEYS: string[] = PAGES.map((p) => p.key);

/**
 * Map an API request path to the page it belongs to, so the guard can enforce
 * per-page access. Returns null for paths not tied to a page (auth, health,
 * public, dashboard aggregate) which are never page-gated.
 */
export function pageForApiPath(path: string): PageKey | null {
  const p = path.replace(/^\/api\/v1/, "");
  if (p.startsWith("/properties")) return "properties";
  if (p.startsWith("/subscribers") || p.startsWith("/webhooks")) return "subscribers";
  if (p.startsWith("/segments")) return "segments";
  if (p.startsWith("/campaigns")) return "campaigns";
  if (p.startsWith("/automations")) return "automations";
  if (p.startsWith("/google-ads")) return "campaigns"; // ads live under campaigns/traffic
  if (p.startsWith("/updates")) return "updates";
  if (p.startsWith("/troubleshoot")) return "troubleshoot";
  if (
    p.startsWith("/tenant") ||
    p.startsWith("/users") ||
    p.startsWith("/billing") ||
    p.startsWith("/audit")
  ) {
    return "settings";
  }
  return null;
}
