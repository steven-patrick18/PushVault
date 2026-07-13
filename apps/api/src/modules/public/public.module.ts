import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller";
import { WebhooksController } from "./webhooks.controller";
import { PublicService } from "./public.service";
import { GeoService } from "./geo.service";
import { AutomationsModule } from "../automations/automations.module";

@Module({
  imports: [AutomationsModule],
  controllers: [PublicController, WebhooksController],
  providers: [PublicService, GeoService],
})
export class PublicModule {}
