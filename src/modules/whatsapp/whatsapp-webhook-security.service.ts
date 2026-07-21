import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';

@Injectable()
export class WhatsappWebhookSecurityService {
  private readonly maximumClockSkewMs = 5 * 60_000;

  verify(input: {
    rawBody: Buffer;
    signature?: string;
    timestamp?: string;
    now?: number;
  }): void {
    const secret = env.WHATSAPP_WEBHOOK_TOKEN;
    if (!secret) {
      if (env.NODE_ENV === 'production') {
        throw new ForbiddenException('Webhook WhatsApp não configurado.');
      }
      return;
    }

    const timestamp = String(input.timestamp || '').trim();
    const signature = String(input.signature || '').trim().toLowerCase();
    if (!timestamp || !signature) {
      throw new ForbiddenException('Assinatura do webhook ausente.');
    }

    const timestampNumber = Number(timestamp);
    const timestampMs = timestampNumber < 10_000_000_000 ? timestampNumber * 1_000 : timestampNumber;
    if (!Number.isFinite(timestampMs)) {
      throw new ForbiddenException('Timestamp do webhook inválido.');
    }
    const now = input.now ?? Date.now();
    if (Math.abs(now - timestampMs) > this.maximumClockSkewMs) {
      throw new ForbiddenException('Webhook expirado.');
    }

    const expected = `sha256=${createHmac('sha256', secret)
      .update(timestamp)
      .update('.')
      .update(input.rawBody)
      .digest('hex')}`;
    if (!this.safeEquals(signature, expected)) {
      throw new ForbiddenException('Assinatura do webhook inválida.');
    }
  }

  private safeEquals(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  }
}
