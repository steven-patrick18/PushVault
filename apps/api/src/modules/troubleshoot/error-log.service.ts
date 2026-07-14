import { Injectable } from "@nestjs/common";

export type LoggedError = {
  at: string;
  status: number;
  method: string;
  path: string;
  message: string;
  tenantId?: string;
};

/**
 * In-memory ring buffer of recent server errors so non-technical staff can
 * see "what went wrong" on the Troubleshoot page without SSH/docker access.
 * Deliberately memory-only: survives nothing, leaks nothing, needs no table.
 */
@Injectable()
export class ErrorLogService {
  private readonly max = 100;
  private items: LoggedError[] = [];

  push(err: LoggedError) {
    this.items.unshift(err);
    if (this.items.length > this.max) this.items.length = this.max;
  }

  recent(limit = 50): LoggedError[] {
    return this.items.slice(0, limit);
  }
}
