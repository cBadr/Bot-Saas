import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminSecurityGuard } from './admin-security.guard';

@Module({
  imports: [AuthModule],
  providers: [AdminService, AdminSecurityGuard],
  controllers: [AdminController],
  exports: [AdminService, AdminSecurityGuard],
})
export class AdminModule {}
