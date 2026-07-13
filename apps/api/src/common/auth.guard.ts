import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

export interface AuthUser {
  userId: string;
  tenantId: string;
  role: "admin" | "manager" | "operator" | "client";
  email: string;
  /** role=client: the only properties this user may see (empty = none) */
  propertyIds: string[];
}

// operator = daily-ops role: may run campaign lifecycle actions, nothing else
const OPERATOR_ALLOWED_WRITES =
  /^\/api\/v1\/campaigns\/[0-9a-f-]{36}\/(send-now|pause|resume|cancel|test-send)$/;

/** Prisma `where` fragment limiting a client-role user to their properties. */
export function propertyScope(user: AuthUser): Record<string, unknown> {
  if (user.role !== "client") return {};
  return { propertyId: { in: user.propertyIds } };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("Missing bearer token");
    }
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    (req as any).user = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
      propertyIds: payload.propertyIds ?? [],
    } satisfies AuthUser;
    // client portal is read-only
    if (payload.role === "client" && req.method !== "GET") {
      throw new ForbiddenException("Client accounts are read-only");
    }
    // operators: lifecycle actions only (plus the audience-count helper the UI uses)
    if (payload.role === "operator" && req.method !== "GET") {
      const path = (req.baseUrl ?? "") + (req.path ?? "");
      const allowed =
        OPERATOR_ALLOWED_WRITES.test(path) ||
        path === "/api/v1/campaigns/audience-count" ||
        /^\/api\/v1\/segments\/[0-9a-f-]{36}\/count$/.test(path);
      if (!allowed) {
        throw new ForbiddenException("Operators can run campaigns but not edit content or settings");
      }
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
