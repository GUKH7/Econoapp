import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FinancialScope, TransactionSource, TransactionType } from '@prisma/client';

vi.mock('@/config/env', () => ({
  env: {
    WHATSAPP_BOT_API_URL: 'http://whatsapp-api.test/econoapp',
    WHATSAPP_BOT_SEND_MESSAGE_PATH: '/send-message',
    WHATSAPP_ADMIN_PHONES: '',
    WHATSAPP_WEBHOOK_TOKEN: '',
  },
}));

import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';

describe('WhatsappService', () => {
  let service: WhatsappService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let prismaMock: {
    user: { findFirst: ReturnType<typeof vi.fn> };
    salesChannel: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    category: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    transaction: { aggregate: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  };
  let geminiMock: { extractFinancialData: ReturnType<typeof vi.fn> };
  let transactionServiceMock: { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    prismaMock = {
      user: { findFirst: vi.fn() },
      salesChannel: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      category: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      transaction: { aggregate: vi.fn(), groupBy: vi.fn(), findFirst: vi.fn() },
    };
    geminiMock = { extractFinancialData: vi.fn() };
    transactionServiceMock = { create: vi.fn() };
    service = new WhatsappService(prismaMock as never, geminiMock as never, transactionServiceMock as never);
  });

  it('consulta o status da API WhatsApp', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 'conectado' }),
    });

    await expect(service.getStatus()).resolves.toEqual({ status: 'conectado' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://whatsapp-api.test/econoapp/status',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
  });

  it('normaliza status envelopado e aliases de QR Code', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { status: 'aguardando_qr', qrCode: 'qr-base64' } }),
    });

    await expect(service.getStatus()).resolves.toEqual({ status: 'aguardando_qr', qrcode: 'qr-base64' });
  });

  it('envia mensagem usando aliases aceitos pela API', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'conectado' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

    await expect(
      service.sendMessage({ to: '+55 (11) 99999-9999', text: 'Mensagem de teste' }),
    ).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://whatsapp-api.test/econoapp/send-message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '5511999999999', message: 'Mensagem de teste' }),
      }),
    );
  });

  it('nao envia mensagem quando status nao esta conectado', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 'aguardando_qr' }),
    });

    await expect(
      service.sendMessage({ phone: '5511999999999', message: 'Mensagem de teste' }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejeita telefone sem DDI do Brasil', async () => {
    await expect(
      service.sendMessage({ phone: '11999999999', message: 'Mensagem de teste' }),
    ).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propaga erro quando WhatsApp nao esta pronto', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'conectado' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'WhatsApp nao esta pronto.' }),
      });

    await expect(
      service.sendMessage({ phone: '5511999999999', message: 'Mensagem de teste' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('processa webhook de mensagem e salva transacao para o usuario do telefone', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'conectado' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      phone: '11999999999',
    });
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Alimentacao' }]);
    prismaMock.salesChannel.findFirst.mockResolvedValue(null);
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Alimentacao',
    });
    geminiMock.extractFinancialData.mockResolvedValue({
      amount: 35,
      type: 'EXPENSE',
      categoryHint: 'Alimentacao',
      channelHint: null,
      confidence: 0.95,
    });
    transactionServiceMock.create.mockResolvedValue({
      id: 'tx-1',
      description: 'Gastei R$ 35 no mercado',
      amount: 35,
      type: TransactionType.EXPENSE,
    });

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Gastei R$ 35 no mercado',
    });

    expect(result.reply).toContain('Lancamento registrado');
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ phone: '5511999999999' }, { phone: '11999999999' }],
      },
    });
    expect(transactionServiceMock.create).toHaveBeenCalledWith('user-1', {
      description: 'Gastei R$ 35 no mercado',
      amount: 35,
      type: TransactionType.EXPENSE,
      source: TransactionSource.WHATSAPP,
      scope: FinancialScope.PERSONAL,
      categoryId: 'category-1',
    });
  });
});
