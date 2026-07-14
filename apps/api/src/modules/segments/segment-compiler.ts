import { BadRequestException } from "@nestjs/common";

/**
 * Segment filter grammar (§6) → Prisma `where` object.
 * Whitelisted fields only; unknown fields are rejected. The caller always
 * appends `status: 'active'` and `propertyId` — never trust criteria for those.
 */

type Op =
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "between"
  | "gte"
  | "lte"
  | "contains"
  | "older_than_days"
  | "newer_than_days";

interface Condition {
  field: string;
  op: Op;
  value: unknown;
}

export interface SegmentCriteria {
  all?: Condition[];
  /** explicit "every active lead in the property" bucket (deliberate, never inferred) */
  all_active?: boolean;
  /** hand-picked leads always in the segment (even if the filter misses them) */
  manual_include?: string[];
  /** hand-removed leads never in the segment (even if the filter matches) */
  manual_exclude?: string[];
}

/**
 * Full audience `where`: (filter matches OR manually added) AND NOT manually removed.
 * This is what counting, sending and member listing must all use.
 *
 * Empty filter semantics:
 *  - `all_active: true` → the whole active property (minus manual excludes).
 *    This is the ONLY way to get an "everyone" bucket; it must be set
 *    deliberately, never inferred from emptiness.
 *  - conditions present → the filter (OR any manual includes).
 *  - no conditions BUT manual includes present → JUST those leads.
 *  - nothing at all (no flag, no filter, no includes) → NOBODY.
 *
 * The last rule is a safety guarantee: when a manual-only segment's last
 * member is reassigned elsewhere, its criteria become
 * `{manual_include:[], manual_exclude:[id]}`. Inferring "everyone" from the
 * empty include there would blast the entire property minus one lead. So an
 * emptied bucket resolves to nobody, and a whole-property blast requires the
 * explicit `all_active` flag (or a campaign's own `targetAll`).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only well-formed UUIDs so a poisoned manual list can't 500 every query. */
function cleanIds(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
}

export function segmentAudienceWhere(criteria: SegmentCriteria): Record<string, any> {
  const base = compileCriteria(criteria);
  const hasFilter = Object.keys(base).length > 0;
  const include = cleanIds(criteria?.manual_include);
  const exclude = cleanIds(criteria?.manual_exclude);
  const allActive = (criteria as any)?.all_active === true;

  let where: Record<string, any>;
  if (allActive) {
    where = {}; // explicit everyone bucket
  } else if (hasFilter) {
    where = include.length > 0 ? { OR: [base, { id: { in: include } }] } : base;
  } else if (include.length > 0) {
    where = { id: { in: include } }; // manual-only bucket → exactly its members
  } else {
    where = { id: { in: [] } }; // emptied / undefined bucket → nobody (never "everyone")
  }
  if (exclude.length > 0) {
    where = { AND: [where, { id: { notIn: exclude } }] };
  }
  return where;
}

// snake_case grammar field → Prisma model field + kind (for value coercion)
const FIELDS: Record<string, { column: string; kind: "string" | "number" | "date" }> = {
  subscribed_at: { column: "subscribedAt", kind: "date" },
  last_push_at: { column: "lastPushAt", kind: "date" },
  last_click_at: { column: "lastClickAt", kind: "date" },
  utm_source: { column: "utmSource", kind: "string" },
  utm_medium: { column: "utmMedium", kind: "string" },
  utm_campaign: { column: "utmCampaign", kind: "string" },
  utm_content: { column: "utmContent", kind: "string" },
  utm_term: { column: "utmTerm", kind: "string" },
  landing_url: { column: "landingUrl", kind: "string" },
  referrer: { column: "referrer", kind: "string" },
  country: { column: "country", kind: "string" },
  region: { column: "region", kind: "string" },
  city: { column: "city", kind: "string" },
  device: { column: "device", kind: "string" },
  browser: { column: "browser", kind: "string" },
  os: { column: "os", kind: "string" },
  language: { column: "language", kind: "string" },
  timezone: { column: "timezone", kind: "string" },
  pushes_received: { column: "pushesReceived", kind: "number" },
  pushes_clicked: { column: "pushesClicked", kind: "number" },
};

function coerce(kind: "string" | "number" | "date", value: unknown): any {
  if (kind === "date") {
    const d = new Date(String(value));
    if (isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
    return d;
  }
  if (kind === "number") {
    const n = Number(value);
    if (isNaN(n)) throw new BadRequestException(`Invalid number: ${value}`);
    return n;
  }
  return String(value);
}

export function compileCriteria(criteria: SegmentCriteria): Record<string, any> {
  const conditions = criteria?.all ?? [];
  if (!Array.isArray(conditions)) {
    throw new BadRequestException("criteria.all must be an array");
  }
  const where: Record<string, any> = {};
  const and: Record<string, any>[] = [];

  for (const c of conditions) {
    const spec = FIELDS[c.field];
    if (!spec) throw new BadRequestException(`Unknown segment field: ${c.field}`);
    const { column, kind } = spec;
    let clause: Record<string, any>;

    switch (c.op) {
      case "eq":
        clause = { [column]: coerce(kind, c.value) };
        break;
      case "neq":
        clause = { [column]: { not: coerce(kind, c.value) } };
        break;
      case "in":
      case "nin": {
        if (!Array.isArray(c.value)) throw new BadRequestException(`${c.op} needs an array value`);
        const list = c.value.map((v) => coerce(kind, v));
        clause = { [column]: c.op === "in" ? { in: list } : { notIn: list } };
        break;
      }
      case "between": {
        if (!Array.isArray(c.value) || c.value.length !== 2) {
          throw new BadRequestException("between needs [min, max]");
        }
        clause = { [column]: { gte: coerce(kind, c.value[0]), lte: coerce(kind, c.value[1]) } };
        break;
      }
      case "gte":
        clause = { [column]: { gte: coerce(kind, c.value) } };
        break;
      case "lte":
        clause = { [column]: { lte: coerce(kind, c.value) } };
        break;
      case "contains":
        if (kind !== "string") throw new BadRequestException("contains only works on text fields");
        clause = { [column]: { contains: String(c.value), mode: "insensitive" } };
        break;
      case "older_than_days": {
        if (kind !== "date") throw new BadRequestException(`${c.op} only works on date fields`);
        const days = Number(c.value);
        if (isNaN(days) || days < 0) throw new BadRequestException("older_than_days needs a positive number");
        clause = { [column]: { lt: new Date(Date.now() - days * 86400_000) } };
        break;
      }
      case "newer_than_days": {
        if (kind !== "date") throw new BadRequestException(`${c.op} only works on date fields`);
        const days = Number(c.value);
        if (isNaN(days) || days < 0) throw new BadRequestException("newer_than_days needs a positive number");
        clause = { [column]: { gte: new Date(Date.now() - days * 86400_000) } };
        break;
      }
      default:
        throw new BadRequestException(`Unknown op: ${(c as any).op}`);
    }
    and.push(clause);
  }

  if (and.length > 0) where.AND = and;
  return where;
}
