import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "./infra/prisma.service";
import { MaintenanceService } from "./infra/maintenance.service";
import { MembershipService } from "./modules/segments/membership.service";
import { AuthModule } from "./modules/auth/auth.module";
import { PropertiesModule } from "./modules/properties/properties.module";
import { UpdatesModule } from "./modules/updates/updates.module";
import { PublicModule } from "./modules/public/public.module";
import { CampaignsModule } from "./modules/campaigns/campaigns.module";
import { AutomationsModule } from "./modules/automations/automations.module";
import { GoogleAdsModule } from "./modules/google-ads/google-ads.module";
import { TroubleshootModule } from "./modules/troubleshoot/troubleshoot.module";
import { SubscribersController } from "./modules/subscribers/subscribers.controller";
import { SettingsController } from "./modules/settings/settings.controller";
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
    PublicModule,
    CampaignsModule,
    AutomationsModule,
    GoogleAdsModule,
    TroubleshootModule,
  ],
  controllers: [
    HealthController,
    DashboardController,
    SubscribersController,
    SettingsController,
  ],
  providers: [PrismaService, MaintenanceService, MembershipService],
  exports: [PrismaService, MembershipService],
})
export class AppModule {}
