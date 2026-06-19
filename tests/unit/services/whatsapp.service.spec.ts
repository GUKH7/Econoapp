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
    category: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    transaction: {
      aggregate: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    financialAccount: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    creditCard: { findMany: ReturnType<typeof vi.fn> };
    categoryBudget: {
      upsert: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    whatsappConversation: { upsert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  let geminiMock: {
    extractFinancialData: ReturnType<typeof vi.fn>;
    classifyWhatsappMessage: ReturnType<typeof vi.fn>;
    generateWhatsappReply: ReturnType<typeof vi.fn>;
  };
  let transactionServiceMock: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    prismaMock = {
      user: { findFirst: vi.fn() },
      salesChannel: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      category: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
      transaction: { aggregate: vi.fn(), groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
      financialAccount: { findMany: vi.fn(), create: vi.fn() },
      creditCard: { findMany: vi.fn() },
      categoryBudget: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      whatsappConversation: { upsert: vi.fn(), update: vi.fn() },
    };
    prismaMock.categoryBudget.findUnique.mockResolvedValue(null);
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: null,
    });
    geminiMock = {
      extractFinancialData: vi.fn(),
      classifyWhatsappMessage: vi.fn(),
      generateWhatsappReply: vi.fn(),
    };
    transactionServiceMock = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
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

  it('solicita confirmacao antes de salvar a transacao', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Usuario',
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
      description: 'Compra no mercado',
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

    expect(result.reply).toContain('Confirme o lançamento');
    expect(result.reply).toContain('Título: Compra no mercado');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ phone: '5511999999999' }, { phone: '11999999999' }],
      },
    });
    const pendingText = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_CONFIRMATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText })
      .mockResolvedValue({});

    const confirmation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });

    expect(confirmation.reply).toContain('Lancamento registrado');
    expect(transactionServiceMock.create).toHaveBeenCalledWith('user-1', {
      description: 'Compra no mercado',
      amount: 35,
      type: TransactionType.EXPENSE,
      source: TransactionSource.WHATSAPP,
      scope: FinancialScope.PERSONAL,
      categoryId: 'category-1',
    });
  });

  it('alerta sobre duplicidade e exige salvar novamente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    try {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: vi.fn().mockResolvedValue(
          url.endsWith('/status') ? { status: 'conectado' } : { success: true },
        ),
      }));
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'Gustavo',
        phone: '11999999999',
      });
      prismaMock.salesChannel.findMany.mockResolvedValue([]);
      prismaMock.category.findMany.mockResolvedValue([{ name: 'Alimentação' }]);
      prismaMock.financialAccount.findMany.mockResolvedValue([]);
      prismaMock.creditCard.findMany.mockResolvedValue([]);
      prismaMock.transaction.findMany.mockResolvedValue([
        {
          id: 'expense-existing',
          description: 'Compra no mercado',
          amount: 35,
          netAmount: 35,
          type: TransactionType.EXPENSE,
          scope: FinancialScope.PERSONAL,
          date: new Date('2026-06-13T11:30:00Z'),
          category: { id: 'category-food', name: 'Alimentação' },
        },
      ]);
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'category-food',
        name: 'Alimentação',
      });
      geminiMock.extractFinancialData.mockResolvedValue({
        amount: 35,
        type: 'EXPENSE',
        description: 'Compra no mercado',
        categoryHint: 'Alimentação',
        channelHint: null,
        confidence: 0.99,
      });
      transactionServiceMock.create.mockResolvedValue({
        id: 'expense-duplicate',
        description: 'Compra no mercado',
        amount: 35,
        type: TransactionType.EXPENSE,
      });

      const warning = await service.handleWebhook({
        from: '5511999999999',
        text: 'Gastei R$ 35 no mercado',
      });
      expect(warning.reply).toContain('Possível lançamento duplicado');
      expect(warning.reply).toContain('Salvar novamente');
      expect(transactionServiceMock.create).not.toHaveBeenCalled();

      const pendingText = prismaMock.whatsappConversation.upsert.mock.calls
        .map(([input]) => input.update?.pendingText)
        .find(
          (value) =>
            typeof value === 'string' && value.startsWith('__TRANSACTION_CONFIRMATION__:'),
        );
      prismaMock.whatsappConversation.upsert.mockReset();
      prismaMock.whatsappConversation.upsert
        .mockResolvedValueOnce({ recentMessages: [], pendingText })
        .mockResolvedValue({});

      const normalConfirmation = await service.handleWebhook({
        from: '5511999999999',
        text: 'Confirmar',
      });
      expect(normalConfirmation.reply).toContain('preciso que você escreva “Salvar novamente”');
      expect(transactionServiceMock.create).not.toHaveBeenCalled();

      prismaMock.whatsappConversation.upsert.mockReset();
      prismaMock.whatsappConversation.upsert
        .mockResolvedValueOnce({ recentMessages: [], pendingText })
        .mockResolvedValue({});

      const explicitConfirmation = await service.handleWebhook({
        from: '5511999999999',
        text: 'Salvar novamente',
      });
      expect(explicitConfirmation.reply).toContain('Lancamento registrado');
      expect(transactionServiceMock.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancela um rascunho sem salvar a transacao', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText:
        '__TRANSACTION_CONFIRMATION__:{"description":"Compra no mercado","amount":35,"type":"EXPENSE","scope":"PERSONAL","categoryHint":"Alimentação"}',
    });

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Cancelar',
    });

    expect(result.reply).toContain('Lançamento cancelado');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();
    expect(prismaMock.whatsappConversation.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({ pendingText: null, pendingType: null, pendingStep: null }),
    });
  });

  it('permite escolher cartao como forma de pagamento antes de confirmar', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Alimentação' }]);
    prismaMock.financialAccount.findMany.mockResolvedValue([
      { id: 'account-wallet', name: 'Carteira', type: 'WALLET' },
    ]);
    prismaMock.creditCard.findMany.mockResolvedValue([
      { id: 'card-nubank', name: 'Nubank' },
    ]);
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-food',
      name: 'Alimentação',
    });
    geminiMock.extractFinancialData.mockResolvedValue({
      amount: 40,
      type: 'EXPENSE',
      description: 'Almoço no restaurante',
      categoryHint: 'Alimentação',
      channelHint: null,
      confidence: 0.99,
    });
    transactionServiceMock.create.mockResolvedValue({
      id: 'expense-card',
      description: 'Almoço no restaurante',
      amount: 40,
      type: TransactionType.EXPENSE,
    });

    const paymentQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: 'Gastei R$ 40 no restaurante',
    });
    expect(paymentQuestion.reply).toContain('Como você pagou');
    expect(paymentQuestion.reply).toContain('Cartão - Nubank');

    const paymentPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__PAYMENT_SELECTION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: paymentPending })
      .mockResolvedValue({});

    const draftReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Cartão Nubank',
    });
    expect(draftReply.reply).toContain('Forma de pagamento: Cartão - Nubank');

    const transactionPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_CONFIRMATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: transactionPending })
      .mockResolvedValue({});

    const confirmation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });
    expect(confirmation.reply).toContain('Pagamento: Cartão - Nubank');
    expect(transactionServiceMock.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        creditCardId: 'card-nubank',
        amount: 40,
        type: TransactionType.EXPENSE,
      }),
    );
  });

  it('explica a pendencia de pagamento ao receber saudacao durante um lancamento', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Alimentação' }]);
    prismaMock.financialAccount.findMany.mockResolvedValue([
      { id: 'wallet-main', name: 'Carteira', type: 'WALLET' },
    ]);
    prismaMock.creditCard.findMany.mockResolvedValue([]);
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-food',
      name: 'Alimentação',
    });
    geminiMock.extractFinancialData.mockResolvedValue({
      amount: 40,
      type: 'EXPENSE',
      description: 'Almoço no restaurante',
      categoryHint: 'Alimentação',
      channelHint: null,
      confidence: 0.99,
    });

    await service.handleWebhook({
      from: '5511999999999',
      text: 'Gastei R$ 40 no restaurante',
    });
    const paymentPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__PAYMENT_SELECTION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: paymentPending })
      .mockResolvedValue({});

    const reply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Oi',
    });

    expect(reply.reply).toContain('lançamento em andamento');
    expect(reply.reply).toContain('Como você pagou esse gasto?');
    expect(reply.reply).not.toContain('Não reconheci');
  });

  it('pergunta e cria nova forma quando usuario responde outra forma no pagamento', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Casa' }]);
    prismaMock.financialAccount.findMany.mockResolvedValue([
      { id: 'wallet-main', name: 'Carteira', type: 'WALLET' },
    ]);
    prismaMock.creditCard.findMany.mockResolvedValue([]);
    prismaMock.financialAccount.create.mockResolvedValue({
      id: 'wallet-other',
      name: 'Dinheiro Loja',
      type: 'WALLET',
      scope: FinancialScope.PERSONAL,
    });
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-home',
      name: 'Casa',
    });
    geminiMock.extractFinancialData.mockResolvedValue({
      amount: 10,
      type: 'EXPENSE',
      description: 'Compra de toalha',
      categoryHint: 'Casa',
      channelHint: null,
      confidence: 0.99,
    });

    await service.handleWebhook({
      from: '5511999999999',
      text: 'Gastei 10 reais comprando uma toalha',
    });
    const paymentPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__PAYMENT_SELECTION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: paymentPending })
      .mockResolvedValue({});

    const askNameReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Nenhuma delas',
    });

    expect(prismaMock.financialAccount.create).not.toHaveBeenCalled();
    expect(askNameReply.reply).toContain('nome dessa forma de pagamento');

    const newPaymentPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__PAYMENT_SELECTION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: newPaymentPending })
      .mockResolvedValue({});

    const reply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Dinheiro da loja',
    });

    expect(prismaMock.financialAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Dinheiro Loja',
          type: 'WALLET',
          userId: 'user-1',
        }),
      }),
    );
    expect(reply.reply).toContain('Forma de pagamento: Carteira - Dinheiro Loja');
    expect(reply.reply).not.toContain('Não reconheci');
  });

  it('seleciona o unico banco ao receber por Pix', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Serviços' }]);
    prismaMock.financialAccount.findMany.mockResolvedValue([
      { id: 'account-bank', name: 'Nubank', type: 'BANK' },
    ]);
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-service',
      name: 'Serviços',
    });
    geminiMock.extractFinancialData.mockResolvedValue({
      amount: 100,
      type: 'INCOME',
      description: 'Recebimento de serviço',
      categoryHint: 'Serviços',
      channelHint: null,
      confidence: 0.99,
    });
    transactionServiceMock.create.mockResolvedValue({
      id: 'income-pix',
      description: 'Recebimento de serviço',
      amount: 100,
      type: TransactionType.INCOME,
    });

    const paymentQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: 'Recebi R$ 100 por um serviço',
    });
    expect(paymentQuestion.reply).toContain('Em qual conta você recebeu');

    const paymentPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__PAYMENT_SELECTION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: paymentPending })
      .mockResolvedValue({});

    const draftReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Pix',
    });
    expect(draftReply.reply).toContain('Receber em: Banco/Pix - Nubank');

    const transactionPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_CONFIRMATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: transactionPending })
      .mockResolvedValue({});

    await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });
    expect(transactionServiceMock.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'account-bank',
        amount: 100,
        type: TransactionType.INCOME,
      }),
    );
  });

  it('libera o fluxo para o usuario enviar um lancamento corrigido', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText:
        '__TRANSACTION_CONFIRMATION__:{"description":"Compra no mercado","amount":35,"type":"EXPENSE","scope":"PERSONAL","categoryHint":"Alimentação"}',
    });

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Editar',
    });

    expect(result.reply).toContain('Envie novamente o lançamento');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();
    expect(prismaMock.whatsappConversation.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({ pendingText: null, pendingType: null, pendingStep: null }),
    });
  });

  it('pergunta se a venda e pessoal ou do negocio antes de solicitar o canal', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: null })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        recentMessages: [],
        pendingText: 'Eu ganhei mais dinheiro hj',
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        recentMessages: [],
        pendingText: 'Eu ganhei mais dinheiro hj. 200',
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        recentMessages: [],
        pendingText: 'Eu ganhei mais dinheiro hj. 200. Foi uma venda de um relogio',
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        recentMessages: [],
        pendingText: 'Eu ganhei mais dinheiro hj. 200. Foi uma venda de um relogio. Negocio',
      })
      .mockResolvedValueOnce({});
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Relogio' }]);
    prismaMock.salesChannel.findFirst.mockResolvedValue({
      id: 'channel-direct',
      name: 'Venda direta',
    });
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-income',
      name: 'Relogio',
    });
    geminiMock.extractFinancialData
      .mockResolvedValueOnce({
        amount: 200,
        type: 'INCOME',
        categoryHint: 'NAO_ESPECIFICADO',
        channelHint: null,
        confidence: 0.95,
      })
      .mockResolvedValueOnce({
        amount: 200,
        type: 'INCOME',
        categoryHint: 'Relogio',
        channelHint: null,
        confidence: 0.98,
      })
      .mockResolvedValueOnce({
        amount: 200,
        type: 'INCOME',
        categoryHint: 'Relogio',
        channelHint: null,
        confidence: 0.99,
      })
      .mockResolvedValueOnce({
        amount: 200,
        type: 'INCOME',
        description: 'Venda de relógio',
        categoryHint: 'Relogio',
        channelHint: 'Venda direta',
        confidence: 0.99,
      });
    transactionServiceMock.create.mockResolvedValue({
      id: 'tx-income',
      description:
        'Eu ganhei mais dinheiro hj. 200. Foi uma venda de um relogio. Negocio. Venda direta',
      amount: 200,
      type: TransactionType.INCOME,
    });

    const amountQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: 'Eu ganhei mais dinheiro hj',
    });
    expect(amountQuestion.reply).toBe('Quanto você ganhou hoje?');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();

    const sourceQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: '200',
    });
    expect(sourceQuestion.reply).toContain('De onde veio esse dinheiro?');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();

    const scopeQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: 'Foi uma venda de um relógio',
    });
    expect(scopeQuestion.reply).toContain('Pessoal ou Negócio');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();

    const channelQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: 'Negócio',
    });
    expect(channelQuestion.reply).toContain('Por qual canal');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();

    const draftReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Venda direta',
    });
    expect(draftReply.reply).toContain('Confirme o lançamento');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();

    const pendingText = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_CONFIRMATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText })
      .mockResolvedValue({});

    const confirmation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });
    expect(confirmation.reply).toContain('Lancamento registrado');
    expect(transactionServiceMock.create).toHaveBeenCalledTimes(1);
    expect(transactionServiceMock.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        description: 'Venda de relógio',
        amount: 200,
        type: TransactionType.INCOME,
        source: TransactionSource.WHATSAPP,
        scope: FinancialScope.BUSINESS,
        categoryId: 'category-income',
        channelId: 'channel-direct',
      }),
    );
  });

  it('registra venda pessoal sem solicitar canal de venda', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: null })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        recentMessages: [],
        pendingText: 'Vendi um relogio por 200',
      })
      .mockResolvedValueOnce({});
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Relogio' }]);
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-income',
      name: 'Relogio',
    });
    geminiMock.extractFinancialData
      .mockResolvedValueOnce({
        amount: 200,
        type: 'INCOME',
        categoryHint: 'Relogio',
        channelHint: null,
        confidence: 0.98,
      })
      .mockResolvedValueOnce({
        amount: 200,
        type: 'INCOME',
        categoryHint: 'Relogio',
        channelHint: null,
        confidence: 0.99,
      });
    transactionServiceMock.create.mockResolvedValue({
      id: 'tx-income-personal',
      description: 'Vendi um relogio por 200. Pessoal',
      amount: 200,
      type: TransactionType.INCOME,
    });

    const scopeQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: 'Vendi um relógio por 200',
    });
    expect(scopeQuestion.reply).toContain('Pessoal ou Negócio');

    const draftReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Pessoal',
    });
    expect(draftReply.reply).toContain('Confirme o lançamento');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();

    const pendingText = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_CONFIRMATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText })
      .mockResolvedValue({});

    const confirmation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });
    expect(confirmation.reply).toContain('Lancamento registrado');
    expect(confirmation.reply).toContain('Modo: Pessoal');
    expect(prismaMock.salesChannel.findFirst).not.toHaveBeenCalled();
    expect(transactionServiceMock.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        description: 'Venda de relogio',
        amount: 200,
        type: TransactionType.INCOME,
        source: TransactionSource.WHATSAPP,
        scope: FinancialScope.PERSONAL,
        categoryId: 'category-income',
      }),
    );
  });

  it('reconhece servico informado em resposta sem repetir a pergunta de origem', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText: null })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        recentMessages: [],
        pendingText: 'Ganhei 30 reais',
      })
      .mockResolvedValueOnce({});
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([]);
    prismaMock.category.findFirst.mockResolvedValue(null);
    prismaMock.category.findUnique.mockResolvedValue(null);
    prismaMock.category.create.mockResolvedValue({
      id: 'category-service',
      name: 'Serviços',
    });
    geminiMock.extractFinancialData
      .mockResolvedValueOnce({
        amount: 30,
        type: 'INCOME',
        categoryHint: 'NAO_ESPECIFICADO',
        channelHint: null,
        confidence: 0.98,
      })
      .mockResolvedValueOnce({
        amount: 30,
        type: 'INCOME',
        categoryHint: 'NAO_ESPECIFICADO',
        channelHint: null,
        confidence: 0.98,
      });
    transactionServiceMock.create.mockResolvedValue({
      id: 'tx-service',
      description: 'Receita de serviços',
      amount: 30,
      type: TransactionType.INCOME,
    });

    const sourceQuestion = await service.handleWebhook({
      from: '5511999999999',
      text: 'Ganhei 30 reais',
    });
    expect(sourceQuestion.reply).toContain('De onde veio esse dinheiro?');

    const draftReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Foi um serviço que eu fiz',
    });
    expect(draftReply.reply).toContain('Confirme o lançamento');
    expect(transactionServiceMock.create).not.toHaveBeenCalled();

    const pendingText = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_CONFIRMATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText })
      .mockResolvedValue({});

    const confirmation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });
    expect(confirmation.reply).toContain('Lancamento registrado');
    expect(confirmation.reply).toContain('Categoria: Serviços');
    expect(transactionServiceMock.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        description: 'Receita de serviços',
        amount: 30,
        type: TransactionType.INCOME,
        scope: FinancialScope.PERSONAL,
        categoryId: 'category-service',
      }),
    );
  });

  it('responde conversa livre usando IA sem consultar ou alterar transacoes', async () => {
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
      name: 'Gustavo',
      phone: '11999999999',
    });
    geminiMock.classifyWhatsappMessage.mockResolvedValue({
      intent: 'GENERAL_CONVERSATION',
      confidence: 0.98,
    });
    geminiMock.generateWhatsappReply.mockResolvedValue(
      'Olá, Gustavo. Como posso ajudar com suas finanças hoje?',
    );

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Bom dia, tudo bem?',
    });

    expect(result.reply).toContain('Olá, Gustavo');
    expect(geminiMock.generateWhatsappReply).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Bom dia, tudo bem?',
        userName: 'Gustavo',
        financialContext: 'Nenhuma consulta financeira foi solicitada nesta mensagem.',
      }),
    );
    expect(transactionServiceMock.create).not.toHaveBeenCalled();
  });

  it('responde pergunta financeira aberta usando somente contexto calculado pelo backend', async () => {
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
      name: 'Gustavo',
      phone: '11999999999',
    });
    geminiMock.classifyWhatsappMessage.mockResolvedValue({
      intent: 'FINANCIAL_QUERY',
      confidence: 0.96,
    });
    geminiMock.generateWhatsappReply.mockResolvedValue(
      'Seus gastos aumentaram neste mês, principalmente em alimentação.',
    );
    prismaMock.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { netAmount: 2000 } })
      .mockResolvedValueOnce({ _sum: { netAmount: 900 } })
      .mockResolvedValueOnce({ _sum: { netAmount: 1800 } })
      .mockResolvedValueOnce({ _sum: { netAmount: 600 } })
      .mockResolvedValueOnce({ _sum: { netAmount: 1200 } })
      .mockResolvedValueOnce({ _sum: { netAmount: 500 } })
      .mockResolvedValueOnce({ _sum: { netAmount: 800 } })
      .mockResolvedValueOnce({ _sum: { netAmount: 400 } });
    prismaMock.transaction.groupBy.mockResolvedValue([
      { categoryId: 'category-1', _sum: { amount: 500 } },
    ]);
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'category-1', name: 'Alimentação' },
    ]);
    prismaMock.transaction.findMany.mockResolvedValue([]);
    prismaMock.financialAccount.findMany.mockResolvedValue([]);
    prismaMock.creditCard.findMany.mockResolvedValue([]);

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'O que mudou nas minhas finanças em relação ao mês passado?',
    });

    expect(result.reply).toContain('gastos aumentaram');
    expect(geminiMock.generateWhatsappReply).toHaveBeenCalledWith(
      expect.objectContaining({
        financialContext: expect.stringContaining('Mês anterior'),
      }),
    );
    expect(transactionServiceMock.create).not.toHaveBeenCalled();
  });

  it('lista os gastos do mes com categoria, valor e total', async () => {
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
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 'expense-1',
        description: 'Compra de relógio',
        amount: 20,
        netAmount: 20,
        type: TransactionType.EXPENSE,
        date: new Date(),
        category: { id: 'category-watch', name: 'Relógio' },
      },
      {
        id: 'expense-2',
        description: 'Almoço no restaurante',
        amount: 40,
        netAmount: 40,
        type: TransactionType.EXPENSE,
        date: new Date(),
        category: { id: 'category-food', name: 'Alimentação' },
      },
    ]);

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Quais foram meus gastos do mês?',
    });

    const normalizedReply = result.reply.replace(/\u00a0/g, ' ');
    expect(normalizedReply).toContain('Seus gastos deste mês:');
    expect(normalizedReply).toContain('Compra de relógio — Relógio: R$ 20,00');
    expect(normalizedReply).toContain('Almoço no restaurante — Alimentação: R$ 40,00');
    expect(normalizedReply).toContain('Total: R$ 60,00');
    expect(geminiMock.classifyWhatsappMessage).not.toHaveBeenCalled();
    expect(transactionServiceMock.create).not.toHaveBeenCalled();
  });

  it('corrige o valor do ultimo gasto somente depois da confirmacao', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: 'expense-1',
      userId: 'user-1',
      description: 'Compra de relógio',
      amount: 20,
      netAmount: 20,
      type: TransactionType.EXPENSE,
      date: new Date(),
      category: { id: 'category-watch', name: 'Relógio' },
    });
    transactionServiceMock.update.mockResolvedValue({
      id: 'expense-1',
      description: 'Compra de relógio',
      amount: 25,
      type: TransactionType.EXPENSE,
    });

    const draftReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Corrija o último gasto para R$ 25',
    });

    expect(draftReply.reply).toContain('Confirme a correção');
    expect(draftReply.reply.replace(/\u00a0/g, ' ')).toContain('Novo valor: R$ 25,00');
    expect(transactionServiceMock.update).not.toHaveBeenCalled();

    const pendingText = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_MUTATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText })
      .mockResolvedValue({});

    const confirmation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });

    expect(confirmation.reply).toContain('Lançamento corrigido');
    expect(transactionServiceMock.update).toHaveBeenCalledWith('user-1', 'expense-1', {
      amount: 25,
    });
    expect(transactionServiceMock.delete).not.toHaveBeenCalled();
  });

  it('localiza e exclui um lancamento pelo titulo somente depois da confirmacao', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 'expense-1',
        userId: 'user-1',
        description: 'Compra de relógio',
        amount: 20,
        netAmount: 20,
        type: TransactionType.EXPENSE,
        date: new Date(),
        category: { id: 'category-watch', name: 'Relógio' },
      },
    ]);
    transactionServiceMock.delete.mockResolvedValue(undefined);

    const draftReply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Apague o lançamento do relógio',
    });

    expect(draftReply.reply).toContain('Confirme a exclusão');
    expect(draftReply.reply).toContain('Compra de relógio');
    expect(transactionServiceMock.delete).not.toHaveBeenCalled();

    const pendingText = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__TRANSACTION_MUTATION__:'));
    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert
      .mockResolvedValueOnce({ recentMessages: [], pendingText })
      .mockResolvedValue({});

    const confirmation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });

    expect(confirmation.reply).toContain('Lançamento excluído');
    expect(transactionServiceMock.delete).toHaveBeenCalledWith('user-1', 'expense-1');
    expect(transactionServiceMock.update).not.toHaveBeenCalled();
  });

  it('cancela a exclusao e preserva o lancamento', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText:
        '__TRANSACTION_MUTATION__:{"action":"DELETE","transactionId":"expense-1","description":"Compra de relógio","amount":20,"type":"EXPENSE"}',
    });

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Cancelar',
    });

    expect(result.reply).toContain('Exclusão cancelada');
    expect(transactionServiceMock.delete).not.toHaveBeenCalled();
    expect(prismaMock.whatsappConversation.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({ pendingText: null, pendingType: null, pendingStep: null }),
    });
  });

  it('consulta os gastos da semana atual', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    try {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: vi.fn().mockResolvedValue(
          url.endsWith('/status') ? { status: 'conectado' } : { success: true },
        ),
      }));
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'Gustavo',
        phone: '11999999999',
      });
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { netAmount: 500 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 120 } });
      prismaMock.transaction.groupBy.mockResolvedValue([]);

      const result = await service.handleWebhook({
        from: '5511999999999',
        text: 'Gastos da semana',
      });

      expect(result.reply.replace(/\u00a0/g, ' ')).toContain(
        'Nesta semana, você gastou R$ 120,00.',
      );
      expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'EXPENSE',
            date: {
              gte: new Date('2026-06-08T00:00:00.000Z'),
              lt: new Date('2026-06-14T00:00:00.000Z'),
            },
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('consulta despesas de um mes informado pelo nome', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    try {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: vi.fn().mockResolvedValue(
          url.endsWith('/status') ? { status: 'conectado' } : { success: true },
        ),
      }));
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'Gustavo',
        phone: '11999999999',
      });
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { netAmount: 1000 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 350 } });
      prismaMock.transaction.groupBy.mockResolvedValue([]);

      const result = await service.handleWebhook({
        from: '5511999999999',
        text: 'Despesas de maio',
      });

      const reply = result.reply.replace(/\u00a0/g, ' ');
      expect(reply).toContain('Em maio de 2026, você gastou R$ 350,00.');
      expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'EXPENSE',
            date: {
              gte: new Date('2026-05-01T00:00:00.000Z'),
              lt: new Date('2026-06-01T00:00:00.000Z'),
            },
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('compara o mes atual com o anterior sem depender da IA', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    try {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: vi.fn().mockResolvedValue(
          url.endsWith('/status') ? { status: 'conectado' } : { success: true },
        ),
      }));
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'Gustavo',
        phone: '11999999999',
      });
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { netAmount: 2000 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 800 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 1500 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 1000 } });

      const result = await service.handleWebhook({
        from: '5511999999999',
        text: 'Compare este mês com o anterior',
      });

      const reply = result.reply.replace(/\u00a0/g, ' ');
      expect(reply).toContain('Comparação: junho de 2026 x maio de 2026');
      expect(reply).toContain('Receitas: R$ 2.000,00 (aumento de 33,3%)');
      expect(reply).toContain('Gastos: R$ 800,00 (queda de 20,0%)');
      expect(reply).toContain('Saldo: R$ 1.200,00 (antes R$ 500,00)');
      expect(geminiMock.classifyWhatsappMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retoma uma confirmacao salva em estado estruturado', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: null,
      pendingType: 'TRANSACTION',
      pendingStep: 'WAITING_CONFIRMATION',
      pendingData: {
        description: 'Recebimento de serviço',
        amount: 150,
        type: 'INCOME',
        scope: 'PERSONAL',
        categoryHint: 'Serviços',
      },
    });
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-service',
      name: 'Serviços',
    });
    transactionServiceMock.create.mockResolvedValue({
      id: 'income-1',
      description: 'Recebimento de serviço',
      amount: 150,
      type: TransactionType.INCOME,
    });

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });

    expect(result.reply).toContain('Lancamento registrado');
    expect(transactionServiceMock.create).toHaveBeenCalledTimes(1);
  });

  it('reinicia qualquer conversa pendente com Menu', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: 'Ganhei dinheiro hoje',
      pendingType: 'DETAILS',
      pendingStep: 'WAITING_INPUT',
      pendingData: { text: 'Ganhei dinheiro hoje' },
    });

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Menu',
    });

    expect(result.reply).toContain('Posso ajudar');
    expect(prismaMock.whatsappConversation.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({
        pendingText: null,
        pendingType: null,
        pendingStep: null,
      }),
    });
  });

  it('persiste a etapa de coleta e permite cancelar a conversa', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });

    const question = await service.handleWebhook({
      from: '5511999999999',
      text: 'Gastei no mercado',
    });

    expect(question.reply).toContain('Qual foi o valor');
    expect(prismaMock.whatsappConversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          pendingType: 'TRANSACTION_DETAILS',
          pendingStep: 'WAITING_AMOUNT',
          pendingData: { text: 'Gastei no mercado' },
        }),
      }),
    );

    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: 'Gastei no mercado',
      pendingType: 'TRANSACTION_DETAILS',
      pendingStep: 'WAITING_AMOUNT',
      pendingData: { text: 'Gastei no mercado' },
    });

    const cancellation = await service.handleWebhook({
      from: '5511999999999',
      text: 'Cancelar',
    });

    expect(cancellation.reply).toContain('Conversa cancelada');
    expect(prismaMock.whatsappConversation.update).toHaveBeenLastCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({
        pendingText: null,
        pendingType: null,
        pendingStep: null,
      }),
    });
  });

  it('usa resposta natural de descricao pendente para completar um gasto', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([]);
    prismaMock.category.findFirst.mockResolvedValue(null);
    prismaMock.financialAccount.findMany.mockResolvedValue([
      { id: 'wallet-main', name: 'Carteira', type: 'WALLET' },
    ]);
    prismaMock.creditCard.findMany.mockResolvedValue([]);
    geminiMock.extractFinancialData.mockResolvedValue({
      amount: 20,
      type: 'EXPENSE',
      description: 'Gastei 20 reais',
      categoryHint: 'nao_especificado',
      channelHint: null,
      confidence: 0.92,
    });

    const question = await service.handleWebhook({
      from: '5511999999999',
      text: 'Gastei 20 reais',
    });
    expect(question.reply).toContain('Com o que foi esse gasto?');

    prismaMock.whatsappConversation.upsert.mockReset();
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: 'Gastei 20 reais',
      pendingType: 'TRANSACTION_DETAILS',
      pendingStep: 'WAITING_DESCRIPTION',
      pendingData: { text: 'Gastei 20 reais' },
    });

    const reply = await service.handleWebhook({
      from: '5511999999999',
      text: 'Foi comprando uma toalha nova',
    });

    expect(reply.reply).toContain('Como você pagou esse gasto?');
    expect(reply.reply).not.toContain('Com o que foi esse gasto?');
    const paymentPending = prismaMock.whatsappConversation.upsert.mock.calls
      .map(([input]) => input.update?.pendingText)
      .find((value) => typeof value === 'string' && value.startsWith('__PAYMENT_SELECTION__:'));
    expect(paymentPending).toContain('"categoryHint":"Toalha Nova"');
    expect(paymentPending).toContain('"description":"Compra de toalha nova"');
  });

  it('resume os gastos por categoria sem depender da IA', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.transaction.groupBy.mockResolvedValue([
      { categoryId: 'food', _sum: { netAmount: 300 } },
      { categoryId: 'transport', _sum: { netAmount: 100 } },
    ]);
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'food', name: 'Alimentação' },
      { id: 'transport', name: 'Transporte' },
    ]);

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Quais são meus gastos por categoria?',
    });

    const reply = result.reply.replace(/\u00a0/g, ' ');
    expect(reply).toContain('Alimentação: R$ 300,00 (75%)');
    expect(reply).toContain('Transporte: R$ 100,00 (25%)');
    expect(reply).toContain('Total: R$ 400,00');
    expect(geminiMock.classifyWhatsappMessage).not.toHaveBeenCalled();
  });

  it('resume receitas por origem sem depender da IA', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.transaction.groupBy.mockResolvedValue([
      { categoryId: 'salary', _sum: { netAmount: 2000 } },
      { categoryId: 'services', _sum: { netAmount: 500 } },
    ]);
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'salary', name: 'Salário' },
      { id: 'services', name: 'Serviços' },
    ]);

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Mostre minhas receitas por origem',
    });

    const reply = result.reply.replace(/\u00a0/g, ' ');
    expect(reply).toContain('Salário: R$ 2.000,00 (80%)');
    expect(reply).toContain('Serviços: R$ 500,00 (20%)');
  });

  it('compara pessoal e negocio e mostra os maiores aumentos', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    try {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: vi.fn().mockResolvedValue(
          url.endsWith('/status') ? { status: 'conectado' } : { success: true },
        ),
      }));
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'Gustavo',
        phone: '11999999999',
      });
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { netAmount: 1000 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 400 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 3000 } })
        .mockResolvedValueOnce({ _sum: { netAmount: 1200 } });

      const comparison = await service.handleWebhook({
        from: '5511999999999',
        text: 'Compare pessoal versus negócio',
      });
      const comparisonReply = comparison.reply.replace(/\u00a0/g, ' ');
      expect(comparisonReply).toContain('Pessoal x Negócio');
      expect(comparisonReply).toContain('Pessoal — receitas R$ 1.000,00');
      expect(comparisonReply).toContain('Negócio — receitas R$ 3.000,00');

      prismaMock.whatsappConversation.upsert.mockResolvedValue({
        recentMessages: [],
        pendingText: null,
      });
      prismaMock.transaction.groupBy
        .mockResolvedValueOnce([
          { categoryId: 'food', _sum: { netAmount: 500 } },
          { categoryId: 'transport', _sum: { netAmount: 200 } },
        ])
        .mockResolvedValueOnce([
          { categoryId: 'food', _sum: { netAmount: 200 } },
          { categoryId: 'transport', _sum: { netAmount: 180 } },
        ]);
      prismaMock.category.findMany.mockResolvedValue([
        { id: 'food', name: 'Alimentação' },
        { id: 'transport', name: 'Transporte' },
      ]);

      const increases = await service.handleWebhook({
        from: '5511999999999',
        text: 'Quais foram os maiores aumentos de gastos do mês?',
      });
      const increasesReply = increases.reply.replace(/\u00a0/g, ' ');
      expect(increasesReply).toContain('Alimentação: +R$ 300,00');
      expect(increasesReply).toContain('Transporte: +R$ 20,00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('define um orçamento mensal por categoria', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    try {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: vi.fn().mockResolvedValue(
          url.endsWith('/status') ? { status: 'conectado' } : { success: true },
        ),
      }));
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'Gustavo',
        phone: '11999999999',
      });
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'category-food',
        name: 'Alimentação',
      });
      prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { netAmount: 125 } });

      const result = await service.handleWebhook({
        from: '5511999999999',
        text: 'Defina R$ 500 para alimentação',
      });

      expect(result.reply.replace(/\u00a0/g, ' ')).toContain('Limite mensal: R$ 500,00');
      expect(result.reply.replace(/\u00a0/g, ' ')).toContain('Já utilizado: R$ 125,00 (25%)');
      expect(prismaMock.categoryBudget.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            categoryId: 'category-food',
            scope: FinancialScope.PERSONAL,
            amount: 500,
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('avisa quando o gasto se aproxima ou ultrapassa o orçamento', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: null,
      pendingType: 'TRANSACTION',
      pendingStep: 'WAITING_CONFIRMATION',
      pendingData: {
        description: 'Compra no mercado',
        amount: 50,
        type: 'EXPENSE',
        scope: 'PERSONAL',
        categoryHint: 'Alimentação',
      },
    });
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-food',
      name: 'Alimentação',
    });
    transactionServiceMock.create.mockResolvedValue({
      id: 'expense-1',
      description: 'Compra no mercado',
      amount: 50,
      type: TransactionType.EXPENSE,
    });
    prismaMock.categoryBudget.findUnique.mockResolvedValue({
      id: 'budget-food',
      amount: 500,
      alertLevel: 0,
    });
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { netAmount: 450 } });

    const nearLimit = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });
    expect(nearLimit.reply.replace(/\u00a0/g, ' ')).toContain(
      'Orçamento próximo do limite em Alimentação',
    );
    expect(nearLimit.reply).toContain('(90%)');

    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: null,
      pendingType: 'TRANSACTION',
      pendingStep: 'WAITING_CONFIRMATION',
      pendingData: {
        description: 'Outra compra',
        amount: 100,
        type: 'EXPENSE',
        scope: 'PERSONAL',
        categoryHint: 'Alimentação',
      },
    });
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { netAmount: 575 } });

    const exceeded = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });
    const exceededReply = exceeded.reply.replace(/\u00a0/g, ' ');
    expect(exceededReply).toContain('Orçamento excedido em Alimentação');
    expect(exceededReply).toContain('Excesso de R$ 75,00');
  });

  it('envia alerta proativo ao atingir 80% do orçamento', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.categoryBudget.findMany.mockResolvedValue([
      {
        id: 'budget-food',
        userId: 'user-1',
        categoryId: 'category-food',
        scope: FinancialScope.PERSONAL,
        amount: 500,
        alertLevel: 0,
        user: { phone: '11999999999' },
        category: { name: 'Alimentação' },
      },
    ]);
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { netAmount: 425 } });

    const result = await service.runProactiveBudgetAlerts();

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://whatsapp-api.test/econoapp/send-message',
      expect.objectContaining({
        body: expect.stringContaining('Orçamento próximo do limite em Alimentação'),
      }),
    );
    expect(prismaMock.categoryBudget.update).toHaveBeenCalledWith({
      where: { id: 'budget-food' },
      data: { alertLevel: 80, lastAlertAt: expect.any(Date) },
    });
  });

  it('não repete a mesma faixa e escala o alerta quando excede o orçamento', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.categoryBudget.findMany.mockResolvedValue([
      {
        id: 'budget-food',
        userId: 'user-1',
        categoryId: 'category-food',
        scope: FinancialScope.PERSONAL,
        amount: 500,
        alertLevel: 80,
        user: { phone: '5511999999999' },
        category: { name: 'Alimentação' },
      },
    ]);
    prismaMock.transaction.aggregate.mockResolvedValueOnce({ _sum: { netAmount: 450 } });

    await expect(service.runProactiveBudgetAlerts()).resolves.toEqual({
      checked: 1,
      sent: 0,
      skipped: 1,
      failed: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    prismaMock.transaction.aggregate.mockResolvedValueOnce({ _sum: { netAmount: 550 } });
    await expect(service.runProactiveBudgetAlerts()).resolves.toEqual({
      checked: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    expect(prismaMock.categoryBudget.update).toHaveBeenLastCalledWith({
      where: { id: 'budget-food' },
      data: { alertLevel: 100, lastAlertAt: expect.any(Date) },
    });
  });

  it('rearma alertas quando o consumo volta a ficar abaixo de 80%', async () => {
    prismaMock.categoryBudget.findMany.mockResolvedValue([
      {
        id: 'budget-food',
        userId: 'user-1',
        categoryId: 'category-food',
        scope: FinancialScope.PERSONAL,
        amount: 500,
        alertLevel: 100,
        user: { phone: '11999999999' },
        category: { name: 'Alimentação' },
      },
    ]);
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { netAmount: 200 } });

    await expect(service.runProactiveBudgetAlerts()).resolves.toEqual({
      checked: 1,
      sent: 0,
      skipped: 1,
      failed: 0,
    });
    expect(prismaMock.categoryBudget.update).toHaveBeenCalledWith({
      where: { id: 'budget-food' },
      data: { alertLevel: 0, lastAlertAt: null },
    });
  });

  it('reconhece ontem, sexta-feira e dia 10 como datas do lançamento', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T15:00:00Z'));
    try {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: vi.fn().mockResolvedValue(
          url.endsWith('/status') ? { status: 'conectado' } : { success: true },
        ),
      }));
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'Gustavo',
        phone: '11999999999',
      });
      prismaMock.salesChannel.findMany.mockResolvedValue([]);
      prismaMock.category.findMany.mockResolvedValue([{ name: 'Alimentação' }]);
      prismaMock.financialAccount.findMany.mockResolvedValue([]);
      prismaMock.creditCard.findMany.mockResolvedValue([]);
      geminiMock.extractFinancialData.mockResolvedValue({
        amount: 30,
        type: 'EXPENSE',
        description: 'Compra no mercado',
        categoryHint: 'Alimentação',
        channelHint: null,
        confidence: 0.99,
      });

      const expectedDates = [
        ['Gastei R$ 30 no mercado ontem', '2026-06-12T12:00:00.000Z'],
        ['Gastei R$ 30 no mercado sexta-feira', '2026-06-12T12:00:00.000Z'],
        ['Gastei R$ 30 no mercado dia 10', '2026-06-10T12:00:00.000Z'],
      ];

      for (const [text, expectedDate] of expectedDates) {
        prismaMock.whatsappConversation.upsert.mockClear();
        await service.handleWebhook({ from: '5511999999999', text });
        const structuredDraft = prismaMock.whatsappConversation.upsert.mock.calls
          .map(([input]) => input.update?.pendingData)
          .find((value) => value?.transactionDate);
        expect(structuredDraft.transactionDate).toBe(expectedDate);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('cria parcelas mensais futuras com datas e títulos numerados', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.whatsappConversation.upsert.mockResolvedValue({
      recentMessages: [],
      pendingText: null,
      pendingType: 'TRANSACTION',
      pendingStep: 'WAITING_CONFIRMATION',
      pendingData: {
        description: 'Compra de relógio',
        amount: 100,
        totalAmount: 300,
        installmentCount: 3,
        transactionDate: '2026-06-10T12:00:00.000Z',
        type: 'EXPENSE',
        scope: 'PERSONAL',
        categoryHint: 'Relógio',
      },
    });
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'category-watch',
      name: 'Relógio',
    });
    transactionServiceMock.create.mockImplementation(async (_userId, input) => ({
      id: `expense-${input.description}`,
      description: input.description,
      amount: input.amount,
      type: input.type,
    }));

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Confirmar',
    });

    expect(transactionServiceMock.create).toHaveBeenCalledTimes(3);
    expect(transactionServiceMock.create).toHaveBeenNthCalledWith(
      1,
      'user-1',
      expect.objectContaining({
        description: 'Compra de relógio (1/3)',
        amount: 100,
        date: '2026-06-10T12:00:00.000Z',
      }),
    );
    expect(transactionServiceMock.create).toHaveBeenNthCalledWith(
      3,
      'user-1',
      expect.objectContaining({
        description: 'Compra de relógio (3/3)',
        date: '2026-08-10T12:00:00.000Z',
      }),
    );
    expect(result.reply.replace(/\u00a0/g, ' ')).toContain(
      'Parcelas: 3x, a partir de R$ 100,00',
    );
  });

  it('interpreta o parcelamento informado na mensagem natural', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: vi.fn().mockResolvedValue(
        url.endsWith('/status') ? { status: 'conectado' } : { success: true },
      ),
    }));
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Gustavo',
      phone: '11999999999',
    });
    prismaMock.salesChannel.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Relógio' }]);
    prismaMock.financialAccount.findMany.mockResolvedValue([]);
    prismaMock.creditCard.findMany.mockResolvedValue([]);
    geminiMock.extractFinancialData.mockResolvedValue({
      amount: 300,
      type: 'EXPENSE',
      description: 'Compra de relógio',
      categoryHint: 'Relógio',
      channelHint: null,
      confidence: 0.99,
    });

    const result = await service.handleWebhook({
      from: '5511999999999',
      text: 'Comprei um relógio por R$ 300 em 3x',
    });

    const reply = result.reply.replace(/\u00a0/g, ' ');
    expect(reply).toContain('R$ 300,00 em 3x de R$ 100,00');
    expect(prismaMock.whatsappConversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          pendingData: expect.objectContaining({
            amount: 100,
            totalAmount: 300,
            installmentCount: 3,
          }),
        }),
      }),
    );
  });
});
