import { Module } from "@nestjs/common";
import { GoogleAdsController } from "./google-ads.controller";
import { GoogleAdsService } from "./google-ads.service";

@Module({
  controllers: [GoogleAdsController],
  providers: [GoogleAdsService],
})
export class GoogleAdsModule {}
