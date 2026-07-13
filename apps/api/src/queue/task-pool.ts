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
