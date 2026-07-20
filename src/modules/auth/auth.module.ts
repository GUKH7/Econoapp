import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminLoginAttemptsService } from './admin-login-attempts.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AdminLoginAttemptsService],
  exports: [AuthService],
})
export class AuthModule {}
