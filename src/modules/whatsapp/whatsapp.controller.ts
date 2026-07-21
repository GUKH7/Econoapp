import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
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
import { WhatsappQueueService } from './whatsapp-queue.service';
import { WhatsappWebhookSecurityService } from './whatsapp-webhook-security.service';
import { WhatsappDeliveryDto } from './dto/whatsapp-delivery.dto';
import { WhatsappCollectionService } from './whatsapp-collection.service';

type RequestWithRawBody = Request & { rawBody?: Buffer };

@ApiTags('WhatsApp')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    @Inject(WhatsappService) private readonly whatsappService: WhatsappService,
    @Inject(WhatsappScheduledNotificationService)
    private readonly scheduledNotificationService: WhatsappScheduledNotificationService,
    @Inject(WhatsappQueueService) private readonly whatsappQueueService: WhatsappQueueService,
    @Inject(WhatsappWebhookSecurityService)
    private readonly webhookSecurity: WhatsappWebhookSecurityService,
    @Inject(WhatsappCollectionService)
    private readonly collectionService: WhatsappCollectionService,
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
  @HttpCode(202)
  async webhook(
    @Body(new ValidationPipe({ forbidNonWhitelisted: false, transform: false, whitelist: false }))
    dto: WhatsappWebhookDto,
    @Req() request: RequestWithRawBody,
    @Headers('x-whatsapp-signature') signature?: string,
    @Headers('x-whatsapp-timestamp') timestamp?: string,
  ): Promise<{ data: { received: true; duplicate: boolean; messageId: string } }> {
    this.webhookSecurity.verify({
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(dto)),
      ...(signature ? { signature } : {}),
      ...(timestamp ? { timestamp } : {}),
    });
    const data = await this.whatsappQueueService.ingest(dto);
    return { data };
  }

  @ApiOperation({ summary: 'Enviar cobrança explícita de uma conta a receber ao cliente' })
  @Post('collections/:entryId/send')
  async sendCollection(@CurrentUser() user: JwtPayload, @Param('entryId') entryId: string) {
    return { data: await this.collectionService.sendReceivableReminder(user.sub, entryId) };
  }

  @ApiOperation({ summary: 'Consultar filas persistentes e mensagens mortas do WhatsApp' })
  @Get('queue')
  async queueStatus(@CurrentUser() user: JwtPayload) {
    this.ensureWhatsappAdmin(user);
    const data = await this.whatsappQueueService.status();
    return { data };
  }

  @ApiOperation({ summary: 'Reprocessar manualmente uma mensagem morta do WhatsApp' })
  @Post('queue/:kind/:id/retry')
  async retryDeadLetter(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    this.ensureWhatsappAdmin(user);
    if (kind !== 'INBOUND' && kind !== 'OUTBOX') {
      throw new ForbiddenException('Tipo de fila inválido.');
    }
    const data = await this.whatsappQueueService.retryDeadLetter(kind, id);
    return { data };
  }

  @Public()
  @ApiOperation({ summary: 'Receber confirmação de entrega de mensagem WhatsApp' })
  @Post('delivery')
  @HttpCode(202)
  async delivery(
    @Body() dto: WhatsappDeliveryDto,
    @Req() request: RequestWithRawBody,
    @Headers('x-whatsapp-signature') signature?: string,
    @Headers('x-whatsapp-timestamp') timestamp?: string,
  ): Promise<{ data: { updated: boolean } }> {
    this.webhookSecurity.verify({
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(dto)),
      ...(signature ? { signature } : {}),
      ...(timestamp ? { timestamp } : {}),
    });
    const data = await this.whatsappQueueService.applyDelivery(dto);
    return { data };
  }

  @Public()
  @ApiOperation({ summary: 'Executar verificação proativa de orçamentos' })
  @Post('budget-alerts/run')
  async runBudgetAlerts(
    @Headers('x-budget-alert-token') headerToken?: string,
  ) {
    this.ensureBudgetAlertToken(headerToken);
    const data = await this.whatsappService.runProactiveBudgetAlerts();
    return { data };
  }

  @Public()
  @ApiOperation({ summary: 'Executar lembretes de contas, parcelas e vencimentos' })
  @Post('scheduled-notifications/run')
  async runScheduledNotifications(
    @Headers('x-budget-alert-token') headerToken?: string,
  ) {
    this.ensureBudgetAlertToken(headerToken);
    const data = await this.scheduledNotificationService.run();
    return { data };
  }

  private ensureWhatsappAdmin(user: JwtPayload): void {
    if (!isAdminIdentity(user.phone, user.email)) {
      throw new ForbiddenException('A conexao WhatsApp do chatbot e restrita ao administrador.');
    }
  }

  private ensureBudgetAlertToken(token?: string): void {
    if (!env.WHATSAPP_BUDGET_ALERT_TOKEN || token !== env.WHATSAPP_BUDGET_ALERT_TOKEN) {
      throw new ForbiddenException('Execução de alertas de orçamento não autorizada.');
    }
  }
}
