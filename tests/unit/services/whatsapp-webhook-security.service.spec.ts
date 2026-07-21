import { createHmac } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  env: {
    NODE_ENV: 'production',
    WHATSAPP_WEBHOOK_TOKEN: 'segredo-de-webhook-com-mais-de-32-caracteres',
  },
}));

import { WhatsappWebhookSecurityService } from '@/modules/whatsapp/whatsapp-webhook-security.service';

describe('WhatsappWebhookSecurityService', () => {
  const secret = 'segredo-de-webhook-com-mais-de-32-caracteres';
  const now = 1_750_000_000_000;
  const timestamp = String(now);
  const rawBody = Buffer.from('{"messageId":"abc","text":"Oi"}');
  let service: WhatsappWebhookSecurityService;

  beforeEach(() => {
    service = new WhatsappWebhookSecurityService();
  });

  it('aceita assinatura HMAC válida dentro da janela temporal', () => {
    const signature = `sha256=${createHmac('sha256', secret)
      .update(timestamp)
      .update('.')
      .update(rawBody)
      .digest('hex')}`;
    expect(() => service.verify({ rawBody, timestamp, signature, now })).not.toThrow();
  });

  it('rejeita payload alterado', () => {
    const signature = `sha256=${createHmac('sha256', secret)
      .update(timestamp)
      .update('.')
      .update(rawBody)
      .digest('hex')}`;
    expect(() => service.verify({ rawBody: Buffer.from('{"text":"alterado"}'), timestamp, signature, now }))
      .toThrow(ForbiddenException);
  });

  it('rejeita replay fora da janela de cinco minutos', () => {
    const signature = `sha256=${createHmac('sha256', secret)
      .update(timestamp)
      .update('.')
      .update(rawBody)
      .digest('hex')}`;
    expect(() => service.verify({ rawBody, timestamp, signature, now: now + 300_001 }))
      .toThrow(ForbiddenException);
  });
});
