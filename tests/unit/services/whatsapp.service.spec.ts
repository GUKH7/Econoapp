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
    financialAccount: { findMany: ReturnType<typeof vi.fn> };
    creditCard: { findMany: ReturnType<typeof vi.fn> };
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
      financialAccount: { findMany: vi.fn() },
      creditCard: { findMany: vi.fn() },
      whatsappConversation: { upsert: vi.fn(), update: vi.fn() },
    };
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
      data: { pendingText: null },
    });
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
      data: { pendingText: null },
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
      data: { pendingText: null },
    });
  });
});
