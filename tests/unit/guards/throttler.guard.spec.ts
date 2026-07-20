import { describe, expect, it } from 'vitest';
import { clientIpFromRequest } from '@/common/guards/throttler.guard';

describe('clientIpFromRequest', () => {
  it('usa o primeiro IP encaminhado pelo proxy do Render', () => {
    expect(clientIpFromRequest({
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.8' },
      ip: '10.0.0.9',
    })).toBe('203.0.113.10');
  });

  it('usa o IP da conexão quando não há cabeçalho de proxy', () => {
    expect(clientIpFromRequest({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
  });
});
