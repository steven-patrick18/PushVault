import { Module } from "@nestjs/common";
import { AutomationsController } from "./automations.controller";
import { AutomationsService } from "./automations.service";
import { PushService } from "../campaigns/push.service";

@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService, PushService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
