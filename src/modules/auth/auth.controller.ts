import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { env } from '@/config/env';
import { JwtPayload } from '@/common/types';
import { AuthTokensResponse, UserResponse } from '@/common/types/response.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AllowInactive } from '@/common/decorators/allow-inactive.decorator';
import { clientIpFromRequest } from '@/common/guards/throttler.guard';
import { AdminLoginAttemptsService } from './admin-login-attempts.service';

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AdminLoginAttemptsService) private readonly adminLoginAttempts: AdminLoginAttemptsService,
  ) {}

  @ApiOperation({ summary: 'Criar nova conta de usuário' })
  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<{ data: AuthTokensResponse }> {
    const data = await this.authService.register(dto);
    return { data };
  }

  @ApiOperation({ summary: 'Autenticar usuário e obter tokens JWT' })
  @Public()
  @Throttle({ default: { limit: env.NODE_ENV === 'development' ? 60 : 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<{ data: AuthTokensResponse }> {
    const data = await this.authService.login(dto);
    return { data };
  }

  @ApiOperation({ summary: 'Autenticar no painel administrativo' })
  @Public()
  @SkipThrottle({ default: true })
  @Post('admin-login')
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Req() request: Request,
  ): Promise<{ data: AuthTokensResponse }> {
    const ip = clientIpFromRequest(request as unknown as Record<string, unknown>);
    const attemptKey = this.adminLoginAttempts.key(ip, dto.login);
    this.adminLoginAttempts.assertAllowed(attemptKey);
    try {
      const data = await this.authService.adminLogin(dto);
      this.adminLoginAttempts.clear(attemptKey);
      return { data };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.UNAUTHORIZED) {
        this.adminLoginAttempts.recordFailure(attemptKey);
      }
      throw error;
    }
  }

  @ApiOperation({ summary: 'Autenticar ou criar conta com Google' })
  @Public()
  @Throttle({ default: { limit: env.NODE_ENV === 'development' ? 60 : 10, ttl: 60000 } })
  @Post('google')
  async google(
    @Body() dto: GoogleLoginDto,
  ): Promise<{ data: AuthTokensResponse | { requiresPhone: true } }> {
    const data = await this.authService.googleLogin(dto);
    return { data };
  }

  @ApiOperation({ summary: 'Renovar access token usando refresh token' })
  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto): Promise<{ data: AuthTokensResponse }> {
    const data = await this.authService.refresh(dto.refreshToken);
    return { data };
  }

  @ApiOperation({ summary: 'Solicitar link de recuperação de senha' })
  @Public()
  @Throttle({ default: { limit: env.NODE_ENV === 'development' ? 30 : 3, ttl: 900000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ data: { accepted: true } }> {
    await this.authService.requestPasswordReset(dto.email);
    return { data: { accepted: true } };
  }

  @ApiOperation({ summary: 'Redefinir senha usando token de uso único' })
  @Public()
  @Throttle({ default: { limit: env.NODE_ENV === 'development' ? 30 : 5, ttl: 900000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ data: { success: true } }> {
    await this.authService.resetPassword(dto.token, dto.password);
    return { data: { success: true } };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Encerrar sessão e invalidar refresh token' })
  @UseGuards(AuthGuard)
  @AllowInactive()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Retornar dados do usuário autenticado' })
  @UseGuards(AuthGuard)
  @AllowInactive()
  @Get('me')
  async me(@CurrentUser() user: JwtPayload): Promise<{ data: UserResponse }> {
    const data = await this.authService.me(user.sub);
    return { data };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualizar perfil do usuário autenticado' })
  @AllowInactive()
  @Patch('me')
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ data: UserResponse }> {
    const data = await this.authService.updateProfile(user.sub, dto);
    return { data };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Exportar uma cópia dos dados da conta' })
  @AllowInactive()
  @Get('me/export')
  async exportAccount(@CurrentUser() user: JwtPayload): Promise<{ data: unknown }> {
    const data = await this.authService.exportAccountData(user.sub);
    return { data };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Excluir permanentemente a conta autenticada' })
  @AllowInactive()
  @Delete('me')
  @HttpCode(204)
  async deleteAccount(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeleteAccountDto,
  ): Promise<void> {
    await this.authService.deleteAccount(user.sub, dto.password);
  }
}
