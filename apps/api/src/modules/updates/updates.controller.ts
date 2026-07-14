import { Controller, ForbiddenException, Get, Post, Query, UseGuards } from "@nestjs/common";
import { UpdatesService } from "./updates.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";

@Controller("updates")
@UseGuards(JwtAuthGuard)
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  // git history + remote URL (may embed a token) is internal — staff only
  private assertStaff(user: AuthUser) {
    if (user.role !== "admin" && user.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can view updates");
    }
  }

  @Get()
  get(@CurrentUser() user: AuthUser, @Query("check") check?: string) {
    this.assertStaff(user);
    return this.updates.getUpdates(check === "1");
  }

  @Post("pull")
  pull(@CurrentUser() user: AuthUser) {
    if (user.role !== "admin") throw new ForbiddenException("Only admins can pull updates");
    return this.updates.pull();
  }
}
