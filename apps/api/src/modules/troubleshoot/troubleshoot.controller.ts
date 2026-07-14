import { Controller, ForbiddenException, Get, UseGuards } from "@nestjs/common";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";
import { TroubleshootService } from "./troubleshoot.service";

@Controller("troubleshoot")
@UseGuards(JwtAuthGuard)
export class TroubleshootController {
  constructor(private readonly service: TroubleshootService) {}

  /** Self-serve diagnostics. Admin/manager only (exposes cross-property health). */
  @Get()
  diagnose(@CurrentUser() user: AuthUser) {
    if (user.role !== "admin" && user.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can view diagnostics");
    }
    return this.service.diagnose(user);
  }
}
