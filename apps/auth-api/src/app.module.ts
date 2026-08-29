import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";

@Module({
  controllers: [HealthController],
  imports: [AuthModule],
})
export class AppModule {}
