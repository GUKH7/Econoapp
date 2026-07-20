import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { UpdateUserAccessDto } from './dto/update-user-access.dto';
import { UpdateWhatsappProviderTokenDto } from './dto/update-whatsapp-provider-token.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Resumo administrativo de usuários e pagamentos' })
  async overview() {
    return { data: await this.adminService.overview() };
  }

  @Get('settings/whatsapp')
  @ApiOperation({ summary: 'Consultar a configuração segura do provedor WhatsApp' })
  async whatsappSettings() {
    return { data: await this.adminService.whatsappSettings() };
  }

  @Put('settings/whatsapp/token')
  @ApiOperation({ summary: 'Cadastrar a credencial segura do provedor WhatsApp' })
  async updateWhatsappProviderToken(@Body() dto: UpdateWhatsappProviderTokenDto) {
    return { data: await this.adminService.updateWhatsappProviderToken(dto.token) };
  }

  @Get('users')
  @ApiOperation({ summary: 'Listar usuários para administração' })
  async users(@Query() query: AdminUserQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Patch('users/:id/access')
  @ApiOperation({ summary: 'Alterar o estado de acesso de um usuário' })
  async updateAccess(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserAccessDto,
  ) {
    return { data: await this.adminService.updateAccess(admin.sub, userId, dto.status) };
  }

  @Post('users/:id/payments')
  @ApiOperation({ summary: 'Registrar pagamento manual e liberar o usuário' })
  async recordPayment(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return { data: await this.adminService.recordPayment(admin.sub, userId, dto) };
  }

  @Get('users/:id/payments')
  @ApiOperation({ summary: 'Consultar histórico de pagamentos de um usuário' })
  async paymentHistory(@Param('id', ParseUUIDPipe) userId: string) {
    return { data: await this.adminService.paymentHistory(userId) };
  }

  @Delete('users/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Excluir permanentemente um usuário' })
  async deleteUser(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) userId: string): Promise<void> {
    await this.adminService.deleteUser(admin.sub, userId);
  }
}
