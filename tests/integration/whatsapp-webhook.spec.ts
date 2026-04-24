/**
 * Testes unitários de WhatsAppService.handleIncomingMessage usando mocks completos
 * de todas as dependências (sem banco real, sem API Gemini/Whisper, sem HTTP).
 *
 * Fluxo real do método (ordem de saída antecipada):
 *   1. !message || !contact             → retorno imediato
 *   2. messageId duplicado              → retorno imediato
 *   3. type !== 'text' && !== 'audio'   → retorno antecipado
 *   4. user não encontrado              → retorno silencioso
 *
 * vi.mock é içado (hoisted) pelo Vitest antes de qualquer import, portanto
 * @/config/env nunca executa seu process.exit(1) em ambiente de teste.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import { WhatsAppService } from '@/modules/whatsapp/whatsapp.service';
import { PrismaService } from '@/config/database';
import { GeminiService } from '@/services/ai/gemini.service';
import { TransactionRepository } from '@/modules/transactions/repositories/transaction.repository';
import type { WhatsAppWebhookPayload } from '@/modules/whatsapp/schemas/webhook-payload.schema';

vi.mock('@/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
    JWT_SECRET: 'super-secret-key-for-integration-tests-min32!!',
    JWT_EXPIRES_IN: '1h',
    JWT_REFRESH_EXPIRES_IN: '7d',
    WHATSAPP_TOKEN: 'test-whatsapp-token',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    WHATSAPP_APP_SECRET: 'test-app-secret',
    WHATSAPP_PHONE_ID: 'test-phone-id',
    GEMINI_API_KEY: 'test-gemini-api-key',
    PORT: 3001,
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas pelo NestJS
// ---------------------------------------------------------------------------

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  salesChannel: {
    findFirst: vi.fn(),
  },
  category: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

const mockGemini = {
  extractFinancialData: vi.fn(),
  extractFinancialDataFromAudio: vi.fn(),
};

const mockTransactionRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByWhatsappMessageId: vi.fn().mockResolvedValue(null),
  update: vi.fn(),
  delete: vi.fn(),
  findAllByUser: vi.fn(),
};

// ---------------------------------------------------------------------------
// Builders de payload — cada função produz um WhatsAppWebhookPayload válido
// para um determinado cenário sem repetição de boilerplate nos testes.
// ---------------------------------------------------------------------------

/**
 * Payload que contém apenas uma notificação de status de entrega/leitura.
 * Não possui `messages` nem `contacts`, simulando um webhook de delivery receipt.
 */
function makeStatusOnlyPayload(): WhatsAppWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'ENTRY_STATUS_001',
        changes: [
          {
            field: 'messages',
            value: {
              statuses: [{ id: 'STATUS_001', status: 'delivered' }],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Payload com uma mensagem de texto (type: 'text') simples.
 */
function makeTextPayload(messageId: string, waId: string, body: string): WhatsAppWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'ENTRY_TEXT_001',
        changes: [
          {
            field: 'messages',
            value: {
              contacts: [{ wa_id: waId }],
              messages: [
                {
                  from: waId,
                  id: messageId,
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Payload com uma mensagem de tipo não suportado (ex: 'image').
 * O schema do webhook mapeia tipos desconhecidos para `unknownMessageSchema`
 * (passthrough), que exige apenas id, timestamp e type.
 *
 * O cast `as WhatsAppWebhookPayload` é necessário porque o TypeScript infere
 * o campo `type` da união como discriminante; `'image'` não é aceito como
 * literal de `'text'` ou `'audio'`, mas é válido em `unknownMessageSchema`.
 */
function makeImagePayload(messageId: string, waId: string): WhatsAppWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'ENTRY_IMAGE_001',
        changes: [
          {
            field: 'messages',
            value: {
              contacts: [{ wa_id: waId }],
              messages: [
                {
                  id: messageId,
                  timestamp: '1700000000',
                  type: 'image',
                },
              ] as WhatsAppWebhookPayload['entry'][0]['changes'][0]['value']['messages'],
            },
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Suite de testes
// ---------------------------------------------------------------------------

describe('WhatsAppService › handleIncomingMessage', () => {
  let service: WhatsAppService;

  /**
   * Cria um módulo NestJS isolado por teste.
   * Isso reinicializa o `processedMessageIds` (Set privado da instância),
   * garantindo que não haja vazamento de estado entre casos.
   */
  beforeEach(async () => {
    vi.clearAllMocks();
    mockTransactionRepo.findByWhatsappMessageId.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GeminiService, useValue: mockGemini },
        { provide: TransactionRepository, useValue: mockTransactionRepo },
      ],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  // ── Cenário 1: payload sem mensagem (apenas statuses) ────────────────────

  describe('quando o payload não contém mensagem (apenas status de entrega)', () => {
    it('deve resolver sem lançar erro', async () => {
      const payload = makeStatusOnlyPayload();

      await expect(service.handleIncomingMessage(payload)).resolves.toBeUndefined();
    });

    it('não deve chamar o GeminiService', async () => {
      const payload = makeStatusOnlyPayload();

      await service.handleIncomingMessage(payload);

      expect(mockGemini.extractFinancialData).not.toHaveBeenCalled();
    });

    it('não deve fazer lookup de usuário no banco', async () => {
      const payload = makeStatusOnlyPayload();

      await service.handleIncomingMessage(payload);

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('não deve criar nenhuma transação', async () => {
      const payload = makeStatusOnlyPayload();

      await service.handleIncomingMessage(payload);

      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('também retorna sem erro quando messages e contacts são arrays vazios', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'ENTRY_EMPTY_001',
            changes: [
              {
                field: 'messages',
                value: { messages: [], contacts: [] },
              },
            ],
          },
        ],
      };

      await expect(service.handleIncomingMessage(payload)).resolves.toBeUndefined();
      expect(mockGemini.extractFinancialData).not.toHaveBeenCalled();
    });
  });

  // ── Cenário 2: usuário não encontrado ─────────────────────────────────────

  describe('quando o usuário não é encontrado no banco', () => {
    it('deve resolver sem lançar erro (retorno silencioso)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const payload = makeTextPayload('MSG_NOUSER_001', '5511988880001', 'Recebi R$ 200');

      await expect(service.handleIncomingMessage(payload)).resolves.toBeUndefined();
    });

    it('deve consultar o banco com o telefone formatado com "+" (E.164)', async () => {
      const waId = '5511988880002';
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const payload = makeTextPayload('MSG_NOUSER_002', waId, 'Vendi R$50');

      await service.handleIncomingMessage(payload);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { phone: `+${waId}` },
      });
    });

    it('não deve chamar o GeminiService quando o usuário não existe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const payload = makeTextPayload('MSG_NOUSER_003', '5511988880003', 'Despesa R$30');

      await service.handleIncomingMessage(payload);

      expect(mockGemini.extractFinancialData).not.toHaveBeenCalled();
    });

    it('não deve criar transação quando o usuário não existe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const payload = makeTextPayload('MSG_NOUSER_004', '5511988880004', 'Paguei R$70');

      await service.handleIncomingMessage(payload);

      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
    });
  });

  // ── Cenário 3: tipo de mensagem não suportado (image, sticker etc.) ───────

  describe('quando a mensagem é de tipo não suportado (ex: image)', () => {
    it('deve resolver sem lançar erro', async () => {
      const payload = makeImagePayload('MSG_IMAGE_001', '5511977770001');

      await expect(service.handleIncomingMessage(payload)).resolves.toBeUndefined();
    });

    it('não deve chamar o GeminiService para tipo não suportado', async () => {
      const payload = makeImagePayload('MSG_IMAGE_002', '5511977770002');

      await service.handleIncomingMessage(payload);

      expect(mockGemini.extractFinancialData).not.toHaveBeenCalled();
    });

    it('não deve fazer lookup de usuário para tipo não suportado', async () => {
      const payload = makeImagePayload('MSG_IMAGE_003', '5511977770003');

      await service.handleIncomingMessage(payload);

      // O serviço retorna antecipado na checagem de tipo,
      // antes de chegar em prisma.user.findUnique.
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('não deve criar transação para tipo não suportado', async () => {
      const payload = makeImagePayload('MSG_IMAGE_004', '5511977770004');

      await service.handleIncomingMessage(payload);

      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
    });
  });

  // ── Cenário 4: mensagem duplicada (mesmo messageId enviado duas vezes) ────

  describe('quando a mesma mensagem é recebida duas vezes (messageId duplicado)', () => {
    it('deve resolver sem lançar erro em ambas as chamadas', async () => {
      const messageId = 'MSG_DUP_001';
      const waId = '5511966660001';

      // Usuário não encontrado: a primeira chamada retorna cedo (antes de Gemini/repo),
      // mas ainda passa pela checagem de tipo e pelo lookup de usuário.
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const payload = makeTextPayload(messageId, waId, 'Vendi R$80');

      await expect(service.handleIncomingMessage(payload)).resolves.toBeUndefined();
      await expect(service.handleIncomingMessage(payload)).resolves.toBeUndefined();
    });

    it('deve consultar o banco apenas uma vez (segunda chamada é curto-circuitada antes do lookup)', async () => {
      const messageId = 'MSG_DUP_002';
      const waId = '5511966660002';

      // Com deduplicação por banco:
      // Primeira chamada: findByWhatsappMessageId → null → lookup → user null → return.
      // Segunda chamada: findByWhatsappMessageId → transação encontrada → return imediato (antes do lookup).
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockTransactionRepo.findByWhatsappMessageId
        .mockResolvedValueOnce(null) // primeira chamada: sem duplicata
        .mockResolvedValue({ id: 'tx-dup-002' }); // segunda chamada: duplicata detectada

      const payload = makeTextPayload(messageId, waId, 'Recebi R$300 do cliente');

      await service.handleIncomingMessage(payload); // primeira: não duplicata, user não encontrado
      await service.handleIncomingMessage(payload); // segunda: duplicata detectada, retorna antes do lookup

      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('não deve chamar o GeminiService em nenhuma das duas chamadas (usuário inexistente)', async () => {
      const messageId = 'MSG_DUP_003';
      const waId = '5511966660003';

      mockPrisma.user.findUnique.mockResolvedValue(null);

      const payload = makeTextPayload(messageId, waId, 'Vendi produto R$120');

      await service.handleIncomingMessage(payload);
      await service.handleIncomingMessage(payload);

      expect(mockGemini.extractFinancialData).not.toHaveBeenCalled();
    });

    it('mensagens com IDs distintos devem ser tratadas como eventos independentes', async () => {
      const waId = '5511966660004';

      mockPrisma.user.findUnique.mockResolvedValue(null);

      const payload1 = makeTextPayload('MSG_DISTINCT_A', waId, 'Primeira venda R$100');
      const payload2 = makeTextPayload('MSG_DISTINCT_B', waId, 'Segunda venda R$200');

      await service.handleIncomingMessage(payload1);
      await service.handleIncomingMessage(payload2);

      // IDs diferentes → nenhum é duplicata → dois lookups de usuário distintos
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(1, {
        where: { phone: `+${waId}` },
      });
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { phone: `+${waId}` },
      });
    });
  });
});
