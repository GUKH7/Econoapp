import { BadRequestException } from '@nestjs/common';
import { FinancialScope, RecurrenceFrequency, TransactionType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RecurringTransactionService } from '@/modules/transactions/recurring-transaction.service';

function makePrisma() {
  return {
    category: { findFirst: vi.fn().mockResolvedValue({ id: 'category-id' }) },
    salesChannel: { findFirst: vi.fn().mockResolvedValue({ id: 'channel-id' }) },
    financialAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'account-id' }) },
    creditCard: { findFirst: vi.fn().mockResolvedValue({ id: 'card-id' }) },
    recurringTransaction: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    transaction: { findFirst: vi.fn() },
  };
}

const baseInput = {
  description: 'Assinatura',
  amount: 49.9,
  type: TransactionType.EXPENSE,
  scope: FinancialScope.PERSONAL,
  categoryId: '2f3102eb-67e6-4ba7-a11d-f768bbddbfaf',
  frequency: RecurrenceFrequency.MONTHLY,
  startDate: '2026-01-31T12:00:00.000Z',
};

describe('RecurringTransactionService', () => {
  it('rejeita categoria que nao pertence ao usuario', async () => {
    const prisma = makePrisma();
    prisma.category.findFirst.mockResolvedValue(null);
    const service = new RecurringTransactionService(prisma as never, {} as never);

    await expect(service.create('user-id', baseInput)).rejects.toThrow(BadRequestException);
    expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
  });

  it('mantem recorrencias mensais no ultimo dia disponivel do mes', async () => {
    const prisma = makePrisma();
    prisma.recurringTransaction.findMany.mockResolvedValue([
      {
        id: 'rule-id',
        userId: 'user-id',
        description: 'Assinatura',
        amount: 49.9,
        type: TransactionType.EXPENSE,
        scope: FinancialScope.PERSONAL,
        categoryId: baseInput.categoryId,
        channelId: null,
        accountId: null,
        creditCardId: null,
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        startDate: new Date('2026-01-31T00:00:00.000Z'),
        nextRunAt: new Date('2026-01-31T00:00:00.000Z'),
        endDate: null,
        maxOccurrences: 2,
        generatedCount: 0,
        isActive: true,
      },
    ]);
    prisma.transaction.findFirst.mockResolvedValue(null);
    const transactionService = { create: vi.fn().mockResolvedValue({ id: 'transaction-id' }) };
    const service = new RecurringTransactionService(prisma as never, transactionService as never);

    const result = await service.generateDue('user-id', new Date('2026-02-28T12:00:00.000Z'));

    expect(result.created).toBe(2);
    expect(transactionService.create).toHaveBeenNthCalledWith(
      2,
      'user-id',
      expect.objectContaining({ date: '2026-02-28T00:00:00.000Z' }),
    );
    expect(prisma.recurringTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ generatedCount: 2, isActive: false }) }),
    );
  });
});
