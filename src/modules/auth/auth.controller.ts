import { Body, Controller, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { JwtPayload } from '@/common/types';
import { AuthTokensResponse, UserResponse } from '@/common/types/response.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Criar nova conta de usuário' })
  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<{ data: AuthTokensResponse }> {
    const data = await this.authService.register(dto);
    return { data };
  }

  @ApiOperation({ summary: 'Autenticar usuário e obter tokens JWT' })
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<{ data: AuthTokensResponse }> {
    const data = await this.authService.login(dto);
    return { data };
  }

  @ApiOperation({ summary: 'Renovar access token usando refresh token' })
  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto): Promise<{ data: AuthTokensResponse }> {
    const data = await this.authService.refresh(dto.refreshToken);
    return { data };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Encerrar sessão e invalidar refresh token' })
  @UseGuards(AuthGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Retornar dados do usuário autenticado' })
  @UseGuards(AuthGuard)
  @Get('me')
  async me(@CurrentUser() user: JwtPayload): Promise<{ data: UserResponse }> {
    const data = await this.authService.me(user.sub);
    return { data };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualizar perfil do usuário autenticado' })
  @Patch('me')
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ data: UserResponse }> {
    const data = await this.authService.updateProfile(user.sub, dto);
    return { data };
  }
}
