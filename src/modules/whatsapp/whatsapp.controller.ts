import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { UnauthorizedException } from '@/common/errors/app.exception';
import { env } from '@/config/env';
import {
  whatsappWebhookPayloadSchema,
  WhatsAppWebhookPayload,
} from './schemas/webhook-payload.schema';
import { WhatsAppService } from './whatsapp.service';

@ApiTags('Webhook')
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('webhook')
export class WhatsAppController {
  constructor(@Inject(WhatsAppService) private readonly whatsappService: WhatsAppService) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string | { data: { status: string; webhook: string } } {
    if (!mode && !token && !challenge) {
      return { data: { status: 'ok', webhook: 'online' } };
    }

    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN && challenge) {
      return challenge;
    }
    throw new UnauthorizedException('Falha na verificação do webhook');
  }

  @Post()
  @HttpCode(200)
  async receive(@Body() payload: unknown): Promise<{ data: { received: boolean } }> {
    const parsed = whatsappWebhookPayloadSchema.parse(payload) as WhatsAppWebhookPayload;
    await this.whatsappService.handleIncomingMessage(parsed);
    return { data: { received: true } };
  }
}
