import { describe, expect, it } from 'vitest';
import { sanitizeWhatsappPayload, whatsappPayloadHash } from '@/modules/whatsapp/whatsapp-payload-sanitizer';

describe('sanitizeWhatsappPayload', () => {
  it('remove audio em base64 e segredos antes de persistir observabilidade', () => {
    const payload = sanitizeWhatsappPayload({
      messageId: 'provider-1',
      audio: { base64: 'A'.repeat(1_024), mimeType: 'audio/ogg' },
      authorization: 'Bearer segredo',
      nested: { mediaKey: 'chave-privada', text: 'Gastei 20 no mercado' },
    }) as Record<string, unknown>;

    expect(payload.authorization).toBe('[REDACTED]');
    expect(payload.nested).toEqual({ mediaKey: '[REDACTED]', text: 'Gastei 20 no mercado' });
    expect(payload.audio).toEqual({ base64: '[BINARY_REMOVED:1024]', mimeType: 'audio/ogg' });
  });

  it('produz hash estavel do payload ja higienizado', () => {
    const payload = { text: 'Oi', token: 'segredo' };
    expect(whatsappPayloadHash(payload)).toBe(whatsappPayloadHash(payload));
    expect(whatsappPayloadHash(payload)).toHaveLength(64);
  });
});
