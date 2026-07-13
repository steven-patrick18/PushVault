import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../infra/prisma.service";
import { verifySecret } from "../../common/crypto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    // Login is pre-tenant: uses the system client (RLS does not apply yet).
    const user = await this.prisma.system.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || !verifySecret(password, user.passwordHash)) {
      throw new UnauthorizedException("Invalid email or password");
    }

    await this.prisma.system.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tenant = await this.prisma.system.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true, brandName: true, brandPrimaryColor: true },
    });

    const token = await this.jwt.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      propertyIds: user.propertyIds ?? [],
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: tenant?.brandName ?? tenant?.name ?? "PushVault",
        propertyIds: user.propertyIds ?? [],
      },
    };
  }
}
