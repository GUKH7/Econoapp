import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { AuthGuard } from '@/common/guards/auth.guard';
import { JwtPayload } from '@/common/types';
import { env } from '@/config/env';
import { isAdminIdentity } from '@/modules/auth/auth.service';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { WhatsappWebhookDto } from './dto/whatsapp-webhook.dto';
import { WhatsappScheduledNotificationService } from './whatsapp-scheduled-notification.service';
import { WhatsappService, WhatsappStatusResponse } from './whatsapp.service';

@ApiTags('WhatsApp')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    @Inject(WhatsappService) private readonly whatsappService: WhatsappService,
    @Inject(WhatsappScheduledNotificationService)
    private readonly scheduledNotificationService: WhatsappScheduledNotificationService,
  ) {}

  @ApiOperation({ summary: 'Consultar status da conexao WhatsApp' })
  @Get('status')
  async status(@CurrentUser() user: JwtPayload): Promise<{ data: WhatsappStatusResponse }> {
    this.ensureWhatsappAdmin(user);
    const data = await this.whatsappService.getStatus();
    return { data };
  }

  @ApiOperation({ summary: 'Reiniciar conexao WhatsApp e solicitar novo QR Code' })
  @Get('restart')
  async restart(@CurrentUser() user: JwtPayload): Promise<{ data: WhatsappStatusResponse }> {
    this.ensureWhatsappAdmin(user);
    const data = await this.whatsappService.restart();
    return { data };
  }

  @ApiOperation({ summary: 'Enviar mensagem via WhatsApp' })
  @Post('send-message')
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendWhatsappMessageDto,
  ): Promise<{ data: unknown }> {
    this.ensureWhatsappAdmin(user);
    const data = await this.whatsappService.sendMessage(dto);
    return { data };
  }

  @Public()
  @ApiOperation({ summary: 'Receber mensagens enviadas ao numero unico do chatbot' })
  @Post('webhook')
  async webhook(
    @Body(new ValidationPipe({ forbidNonWhitelisted: false, transform: false, whitelist: false }))
    dto: WhatsappWebhookDto,
    @Headers('x-whatsapp-webhook-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ): Promise<{ data: { received: boolean; phone: string; reply: string } }> {
    this.ensureWebhookToken(headerToken || queryToken);
    const result = await this.whatsappService.handleWebhook(dto);
    return { data: { received: true, ...result } };
  }

  @Public()
  @ApiOperation({ summary: 'Executar verificação proativa de orçamentos' })
  @Post('budget-alerts/run')
  async runBudgetAlerts(
    @Headers('x-budget-alert-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ) {
    this.ensureBudgetAlertToken(headerToken || queryToken);
    const data = await this.whatsappService.runProactiveBudgetAlerts();
    return { data };
  }

  @Public()
  @ApiOperation({ summary: 'Executar lembretes de contas, parcelas e vencimentos' })
  @Post('scheduled-notifications/run')
  async runScheduledNotifications(
    @Headers('x-budget-alert-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ) {
    this.ensureBudgetAlertToken(headerToken || queryToken);
    const data = await this.scheduledNotificationService.run();
    return { data };
  }

  private ensureWhatsappAdmin(user: JwtPayload): void {
    if (!isAdminIdentity(user.phone, user.email)) {
      throw new ForbiddenException('A conexao WhatsApp do chatbot e restrita ao administrador.');
    }
  }

  private ensureWebhookToken(token?: string): void {
    if (!env.WHATSAPP_WEBHOOK_TOKEN && env.NODE_ENV === 'production') {
      throw new ForbiddenException('Webhook WhatsApp nao configurado.');
    }

    if (env.WHATSAPP_WEBHOOK_TOKEN && token !== env.WHATSAPP_WEBHOOK_TOKEN) {
      throw new ForbiddenException('Webhook WhatsApp nao autorizado.');
    }
  }

  private ensureBudgetAlertToken(token?: string): void {
    if (!env.WHATSAPP_BUDGET_ALERT_TOKEN || token !== env.WHATSAPP_BUDGET_ALERT_TOKEN) {
      throw new ForbiddenException('Execução de alertas de orçamento não autorizada.');
    }
  }
}
