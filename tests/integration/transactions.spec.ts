/**
 * Testes unitários de TransactionService.update sem banco real.
 *
 * Todos os providers (PrismaService, TransactionRepository) são substituídos
 * por vi.fn() — o módulo NestJS é compilado via Test.createTestingModule,
 * garantindo que a injeção de dependência funcione sem infraestrutura real.
 *
 * Fluxo do método update (ordem das verificações):
 *   1. transactionRepository.findById(id)
 *   2. Lança NotFoundException se !current
 *   3. Lança ForbiddenException se current.userId !== userId
 *   4. Recalcula netAmount quando amount | channelId | type mudam:
 *        INCOME + canal com taxa → calculateNetAmount(newAmount, feePercent)
 *        Qualquer outro caso     → newAmount  (sem taxa)
 *   5. Persiste via transactionRepository.update(id, data)
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { TransactionType, TransactionSource } from '@prisma/client';
import type { Transaction } from '@prisma/client';

import { TransactionService } from '@/modules/transactions/transaction.service';
import { PrismaService } from '@/config/database';
import { AccountService } from '@/modules/accounts/account.service';
import { TransactionRepository } from '@/modules/transactions/repositories/transaction.repository';
import { SmartCategoryService } from '@/modules/transactions/smart-category.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@/common/errors/app.exception';

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas pelo NestJS
// ---------------------------------------------------------------------------

const mockPrisma = {
  category: {
    findFirst: vi.fn(),
  },
  salesChannel: {
    findFirst: vi.fn(),
  },
};

const mockTransactionRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findAllByUser: vi.fn(),
};

const mockAccountService = {
  ensureAccountBelongsToUser: vi.fn(),
  ensureCardBelongsToUser: vi.fn(),
};

const mockSmartCategoryService = {
  suggestCategoryId: vi.fn(),
  remember: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helper: constrói um objeto Transaction com defaults sensatos.
// Usa "as unknown as Transaction" para evitar preencher todos os campos
// gerados pelo Prisma (Decimal, timestamps etc.) nos mocks.
// ---------------------------------------------------------------------------

function makeTransaction(overrides: Partial<Record<string, unknown>> = {}): Transaction {
  return {
    id: 'tx-default-001',
    userId: 'user-001',
    description: 'Venda de produto',
    amount: 100,
    netAmount: 100,
    type: TransactionType.INCOME,
    source: TransactionSource.MANUAL,
    scope: 'PERSONAL',
    categoryId: 'cat-001',
    channelId: null,
    accountId: null,
    creditCardId: null,
    date: new Date('2024-01-15T12:00:00Z'),
    createdAt: new Date('2024-01-15T12:00:00Z'),
    updatedAt: new Date('2024-01-15T12:00:00Z'),
    ...overrides,
  } as unknown as Transaction;
}

// ---------------------------------------------------------------------------
// Suite de testes
// ---------------------------------------------------------------------------

describe('TransactionService › update', () => {
  let service: TransactionService;

  /**
   * Cria um módulo NestJS isolado para cada teste.
   * vi.clearAllMocks() garante que contadores e implementações de mock
   * não vazem entre casos.
   */
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-001' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TransactionRepository, useValue: mockTransactionRepo },
        { provide: AccountService, useValue: mockAccountService },
        { provide: SmartCategoryService, useValue: mockSmartCategoryService },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
  });

  // ── Cenário 1: amount muda sem canal → netAmount = novo amount ─────────────

  describe('quando amount é atualizado em transação sem canal de vendas', () => {
    it('netAmount deve ser igual ao novo amount (sem dedução de taxa)', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-001',
          userId: 'user-001',
          amount: 100,
          netAmount: 100,
          channelId: null,
          type: TransactionType.INCOME,
        }),
      );
      mockTransactionRepo.update.mockResolvedValue(makeTransaction());

      await service.update('user-001', 'tx-001', { amount: 250 });

      expect(mockTransactionRepo.update).toHaveBeenCalledWith(
        'tx-001',
        expect.objectContaining({
          amount: 250,
          netAmount: 250,
        }),
      );
    });

    it('netAmount deve seguir o novo amount mesmo para tipo EXPENSE', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-002',
          userId: 'user-001',
          amount: 80,
          netAmount: 80,
          channelId: null,
          type: TransactionType.EXPENSE,
        }),
      );
      mockTransactionRepo.update.mockResolvedValue(makeTransaction());

      await service.update('user-001', 'tx-002', { amount: 120 });

      expect(mockTransactionRepo.update).toHaveBeenCalledWith(
        'tx-002',
        expect.objectContaining({
          amount: 120,
          netAmount: 120,
        }),
      );
    });

    it('não deve consultar salesChannel quando não há canal associado', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-003',
          userId: 'user-001',
          channelId: null,
        }),
      );
      mockTransactionRepo.update.mockResolvedValue(makeTransaction());

      await service.update('user-001', 'tx-003', { amount: 300 });

      expect(mockPrisma.salesChannel.findFirst).not.toHaveBeenCalled();
    });

    it('deve incluir somente os campos fornecidos no input ao chamar o repositório', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-004',
          userId: 'user-001',
          channelId: null,
          description: 'Descrição original',
        }),
      );
      mockTransactionRepo.update.mockResolvedValue(makeTransaction());

      // Apenas amount é enviado — description não está no input
      await service.update('user-001', 'tx-004', { amount: 200 });

      const [, updateData] = mockTransactionRepo.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];

      expect(updateData).toHaveProperty('amount', 200);
      expect(updateData).not.toHaveProperty('description');
    });

    it('não deve recalcular netAmount quando nenhum campo financeiro é alterado', async () => {
      // netAmount original: 82 (transação com taxa antiga, canal já desvinculado)
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-005',
          userId: 'user-001',
          amount: 100,
          netAmount: 82,
          channelId: null,
          type: TransactionType.INCOME,
        }),
      );
      mockTransactionRepo.update.mockResolvedValue(makeTransaction());

      // Atualiza apenas a descrição — amount, channelId e type não mudam
      await service.update('user-001', 'tx-005', { description: 'Descrição revisada' });

      expect(mockTransactionRepo.update).toHaveBeenCalledWith(
        'tx-005',
        expect.objectContaining({ netAmount: 82 }),
      );
      expect(mockPrisma.salesChannel.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── Cenário 2: amount muda com canal de 18% → netAmount = amount * 0.82 ──

  describe('quando amount é atualizado em transação com canal de vendas de 18% de taxa', () => {
    it('netAmount deve ser amount * 0.82 (valor líquido após 18% de desconto)', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-006',
          userId: 'user-001',
          amount: 100,
          netAmount: 82,
          channelId: 'ch-001',
          type: TransactionType.INCOME,
        }),
      );
      mockPrisma.salesChannel.findFirst.mockResolvedValue({
        id: 'ch-001',
        name: 'iFood',
        feePercent: 18,
        userId: 'user-001',
      });
      mockTransactionRepo.update.mockResolvedValue(makeTransaction());

      await service.update('user-001', 'tx-006', { amount: 200 });

      // calculateNetAmount(200, 18):
      //   fee  = Math.round((200 * 18 / 100) * 100) / 100 = 36
      //   net  = Math.round((200 - 36) * 100) / 100       = 164
      expect(mockTransactionRepo.update).toHaveBeenCalledWith(
        'tx-006',
        expect.objectContaining({
          amount: 200,
          netAmount: 164,
        }),
      );
    });

    it('deve buscar o canal pelo ID da transação atual e pelo userId do requisitante', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-007',
          userId: 'user-001',
          channelId: 'ch-002',
          type: TransactionType.INCOME,
        }),
      );
      mockPrisma.salesChannel.findFirst.mockResolvedValue({
        id: 'ch-002',
        feePercent: 18,
        userId: 'user-001',
      });
      mockTransactionRepo.update.mockResolvedValue(makeTransaction());

      await service.update('user-001', 'tx-007', { amount: 500 });

      expect(mockPrisma.salesChannel.findFirst).toHaveBeenCalledWith({
        where: { id: 'ch-002', userId: 'user-001' },
      });
    });

    it('rejeita a atualização quando o canal não pertence ao usuário', async () => {
      // Canal estava associado na transação mas foi deletado — findFirst retorna null
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-008',
          userId: 'user-001',
          amount: 100,
          netAmount: 82,
          channelId: 'ch-removido',
          type: TransactionType.INCOME,
        }),
      );
      mockPrisma.salesChannel.findFirst.mockResolvedValue(null);
      await expect(
        service.update('user-001', 'tx-008', { amount: 150 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockTransactionRepo.update).not.toHaveBeenCalled();
    });

    it('deve retornar o resultado do repositório após o update', async () => {
      const savedTx = makeTransaction({
        id: 'tx-009',
        userId: 'user-001',
        amount: 200,
        netAmount: 164,
        channelId: 'ch-001',
      });

      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-009',
          userId: 'user-001',
          amount: 100,
          netAmount: 82,
          channelId: 'ch-001',
          type: TransactionType.INCOME,
        }),
      );
      mockPrisma.salesChannel.findFirst.mockResolvedValue({ id: 'ch-001', feePercent: 18 });
      mockTransactionRepo.update.mockResolvedValue(savedTx);

      const result = await service.update('user-001', 'tx-009', { amount: 200 });

      expect(result).toBe(savedTx);
    });
  });

  // ── Cenário 3: transação não encontrada → NotFoundException ───────────────

  describe('quando a transação não existe no banco', () => {
    it('deve lançar NotFoundException', async () => {
      mockTransactionRepo.findById.mockResolvedValue(null);

      await expect(service.update('user-001', 'tx-inexistente', { amount: 100 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException com mensagem descritiva', async () => {
      mockTransactionRepo.findById.mockResolvedValue(null);

      await expect(service.update('user-001', 'tx-inexistente', { amount: 100 })).rejects.toThrow(
        'Transação não encontrada',
      );
    });

    it('não deve chamar transactionRepository.update quando a transação não existe', async () => {
      mockTransactionRepo.findById.mockResolvedValue(null);

      await expect(service.update('user-001', 'tx-inexistente', { amount: 100 })).rejects.toThrow(
        NotFoundException,
      );

      expect(mockTransactionRepo.update).not.toHaveBeenCalled();
    });

    it('não deve consultar salesChannel quando a transação não existe', async () => {
      mockTransactionRepo.findById.mockResolvedValue(null);

      await expect(service.update('user-001', 'tx-inexistente', { amount: 100 })).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.salesChannel.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── Cenário 4: userId não bate → ForbiddenException ──────────────────────

  describe('quando o userId do requisitante não corresponde ao dono da transação', () => {
    it('deve lançar ForbiddenException', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-010',
          userId: 'user-outro', // dono real é outro usuário
        }),
      );

      await expect(service.update('user-001', 'tx-010', { amount: 100 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deve lançar ForbiddenException com mensagem descritiva', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-011',
          userId: 'user-outro',
        }),
      );

      await expect(service.update('user-001', 'tx-011', { amount: 100 })).rejects.toThrow(
        'Você não pode alterar esta transação',
      );
    });

    it('não deve chamar transactionRepository.update quando o userId não bate', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-012',
          userId: 'user-outro',
        }),
      );

      await expect(service.update('user-001', 'tx-012', { amount: 100 })).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockTransactionRepo.update).not.toHaveBeenCalled();
    });

    it('não deve consultar salesChannel quando o userId não bate', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-013',
          userId: 'user-outro',
          channelId: 'ch-001', // canal existe, mas nem chegamos nessa lógica
        }),
      );

      await expect(service.update('user-001', 'tx-013', { amount: 200 })).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockPrisma.salesChannel.findFirst).not.toHaveBeenCalled();
    });

    it('deve proteger a transação mesmo que o userId seja uma string vazia', async () => {
      mockTransactionRepo.findById.mockResolvedValue(
        makeTransaction({
          id: 'tx-014',
          userId: 'user-001',
        }),
      );

      await expect(service.update('', 'tx-014', { amount: 100 })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
