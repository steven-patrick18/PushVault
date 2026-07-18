import { Global, Module } from "@nestjs/common";
import { DirectoryService } from "./directory.service";
import { DirectoryAdminController } from "./directory-admin.controller";

@Global()
@Module({
  controllers: [DirectoryAdminController],
  providers: [DirectoryService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
