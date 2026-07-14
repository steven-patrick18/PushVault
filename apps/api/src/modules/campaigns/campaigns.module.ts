import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignRunnerService } from "./campaign-runner.service";
import { PushService } from "./push.service";
import { SegmentsController } from "../segments/segments.controller";

@Module({
  controllers: [CampaignsController, SegmentsController],
  providers: [CampaignRunnerService, PushService],
  exports: [CampaignRunnerService],
})
export class CampaignsModule {}
