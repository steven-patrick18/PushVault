/**
 * Concurrency-limited promise pool — the in-process stand-in for BullMQ.
 * One pool per tenant gives send fairness (M3); swap for BullMQ workers when
 * Redis is available (interface kept deliberately tiny for that migration).
 */
export class TaskPool {
  private queue: Array<() => Promise<void>> = [];
  private active = 0;

  constructor(private readonly concurrency: number) {}

  add(fn: () => Promise<void>): void {
    this.queue.push(fn);
    this.pump();
  }

  get pending(): number {
    return this.queue.length + this.active;
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const fn = this.queue.shift()!;
      this.active++;
      fn()
        .catch(() => undefined)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Evenly spaces task starts (campaign pacing). Each wait() reserves the next
 * slot `intervalMs` after the previous one, so N per minute stays smooth
 * regardless of worker concurrency.
 */
export class RateLimiter {
  private nextAt = 0;

  constructor(private intervalMs: number) {}

  /** Live-adjust the rate (sends/min); 0 or less = full speed. */
  setPerMinute(perMinute: number): void {
    this.intervalMs = perMinute > 0 ? 60_000 / perMinute : 0;
  }

  async wait(): Promise<void> {
    if (this.intervalMs <= 0) return; // full speed
    const now = Date.now();
    const reserved = Math.max(this.nextAt, now);
    this.nextAt = reserved + this.intervalMs;
    if (reserved > now) await sleep(reserved - now);
  }
}
