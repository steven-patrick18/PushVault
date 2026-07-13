import { Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { UpdatesService } from "./updates.service";
import { JwtAuthGuard } from "../../common/auth.guard";

@Controller("updates")
@UseGuards(JwtAuthGuard)
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get()
  get(@Query("check") check?: string) {
    return this.updates.getUpdates(check === "1");
  }

  @Post("pull")
  pull() {
    return this.updates.pull();
  }
}
