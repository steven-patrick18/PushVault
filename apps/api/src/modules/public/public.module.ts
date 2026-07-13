import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller";
import { PublicService } from "./public.service";
import { GeoService } from "./geo.service";

@Module({
  controllers: [PublicController],
  providers: [PublicService, GeoService],
})
export class PublicModule {}
