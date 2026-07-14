import { Global, Module } from "@nestjs/common";
import { TroubleshootController } from "./troubleshoot.controller";
import { TroubleshootService } from "./troubleshoot.service";
import { ErrorLogService } from "./error-log.service";

/**
 * Global so the AllExceptionsFilter (registered in main.ts) can share the same
 * ErrorLogService instance that the Troubleshoot page reads from.
 */
@Global()
@Module({
  controllers: [TroubleshootController],
  providers: [TroubleshootService, ErrorLogService],
  exports: [ErrorLogService],
})
export class TroubleshootModule {}
