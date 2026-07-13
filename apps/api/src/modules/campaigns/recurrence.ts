/**
 * Recurrence for scheduled campaigns. Stored in campaigns.recurrence as
 * {freq: 'DAILY'|'WEEKLY'|'MONTHLY', interval: 1, byweekday?: number[]} —
 * byweekday uses 0=Sunday..6=Saturday (JS getDay). Time-of-day comes from
 * the previous occurrence.
 */
export interface Recurrence {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval?: number;
  byweekday?: number[];
}

export function isRecurrence(v: unknown): v is Recurrence {
  return (
    !!v &&
    typeof v === "object" &&
    ["DAILY", "WEEKLY", "MONTHLY"].includes((v as any).freq)
  );
}

export function nextOccurrence(prev: Date, rec: Recurrence): Date {
  const interval = Math.max(1, rec.interval ?? 1);
  const next = new Date(prev);

  if (rec.freq === "DAILY") {
    next.setDate(next.getDate() + interval);
    return next;
  }

  if (rec.freq === "WEEKLY") {
    const days = rec.byweekday?.length ? [...rec.byweekday].sort() : [prev.getDay()];
    // walk forward day by day until we hit an allowed weekday (max 7*interval+7)
    for (let i = 1; i <= 7 * interval + 7; i++) {
      const candidate = new Date(prev);
      candidate.setDate(candidate.getDate() + i);
      if (days.includes(candidate.getDay())) return candidate;
    }
    next.setDate(next.getDate() + 7 * interval);
    return next;
  }

  // MONTHLY: same day-of-month next month (clamped by JS date rollover)
  next.setMonth(next.getMonth() + interval);
  return next;
}

export function describeRecurrence(rec: Recurrence): string {
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (rec.freq === "DAILY") return "daily";
  if (rec.freq === "WEEKLY") {
    return "weekly" + (rec.byweekday?.length ? ` (${rec.byweekday.map((d) => WD[d]).join(", ")})` : "");
  }
  return "monthly";
}
