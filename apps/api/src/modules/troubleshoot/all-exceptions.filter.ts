import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ErrorLogService } from "./error-log.service";

/**
 * Global exception filter that keeps Nest's default response shape but also
 * records server-side failures (5xx) into the in-memory error log shown on
 * the Troubleshoot page. 4xx are normal validation traffic and are skipped.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly errors: ErrorLogService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: any = { statusCode: status, message: "Internal server error" };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === "string" ? { statusCode: status, message: r } : r;
    }

    if (status >= 500) {
      const message =
        exception instanceof Error ? exception.message : String(exception);
      this.errors.push({
        at: new Date().toISOString(),
        status,
        method: req.method,
        path: req.originalUrl ?? req.url,
        message: message.slice(0, 300),
        tenantId: (req as any).user?.tenantId,
      });
      // still surface in docker logs for deep debugging
      console.error(`[api] ${req.method} ${req.originalUrl} → ${status}:`, exception);
    }

    res.status(status).json(body);
  }
}
