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

  /** Live status of an in-progress update (polled by the Updates page). */
  @Get("status")
  status(@CurrentUser() user: AuthUser) {
    this.assertStaff(user);
    return this.updates.status();
  }

  /** One-click "Update now": rebuild + restart to the latest commit. */
  @Post("apply")
  apply(@CurrentUser() user: AuthUser) {
    if (user.role !== "admin") throw new ForbiddenException("Only admins can apply updates");
    return this.updates.requestUpdate();
  }

  // kept for the local-dev checkout case
  @Post("pull")
  pull(@CurrentUser() user: AuthUser) {
    if (user.role !== "admin") throw new ForbiddenException("Only admins can pull updates");
    return this.updates.pull();
  }
}
