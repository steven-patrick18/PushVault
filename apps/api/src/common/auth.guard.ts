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
  role: "admin" | "manager" | "client";
  email: string;
  /** role=client: the only properties this user may see (empty = none) */
  propertyIds: string[];
}

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
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
