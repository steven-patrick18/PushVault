import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "./infra/prisma.service";
import { AuthModule } from "./modules/auth/auth.module";
import { PropertiesModule } from "./modules/properties/properties.module";
import { UpdatesModule } from "./modules/updates/updates.module";
import { DashboardController } from "./modules/dashboard/dashboard.controller";
import { Controller, Get } from "@nestjs/common";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "pushvault-api", time: new Date().toISOString() };
  }
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "dev-secret",
      signOptions: { expiresIn: "12h" },
    }),
    AuthModule,
    PropertiesModule,
    UpdatesModule,
  ],
  controllers: [HealthController, DashboardController],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
