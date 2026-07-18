import { BusinessEntryStatus, BusinessEntryType, RecurrenceFrequency, TransactionType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BusinessService } from '@/modules/business/business.service';

function serviceFixture() {
  const prisma = {
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    category: { findFirst: vi.fn().mockResolvedValue({ id: 'category-1' }) },
    financialAccount: {
      findFirst: vi.fn().mockResolvedValue({ id: 'account-1' }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { balance: 5000 } }),
    },
    transaction: { groupBy: vi.fn().mockResolvedValue([]) },
    businessEntry: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
        id: `entry-${String(data.dueDate)}`,
        status: BusinessEntryStatus.PENDING,
        ...data,
        category: { id: 'category-1', name: 'Vendas', color: '#22C55E' },
        account: null,
      })),
      findMany: vi.fn()
        .mockResolvedValueOnce([
          { id: 'r1', type: BusinessEntryType.RECEIVABLE, amount: 1500, dueDate: new Date('2026-07-20T00:00:00.000Z') },
          { id: 'p1', type: BusinessEntryType.PAYABLE, amount: 600, dueDate: new Date('2026-07-22T00:00:00.000Z') },
        ])
        .mockResolvedValueOnce([]),
    },
  };
  const transactions = { create: vi.fn() };
  return { prisma, service: new BusinessService(prisma as never, transactions as never) };
}

describe('BusinessService', () => {
  it('gera as próximas ocorrências de uma conta recorrente', async () => {
    const { prisma, service } = serviceFixture();
    const result = await service.create('user-1', {
      type: BusinessEntryType.PAYABLE,
      title: 'Aluguel',
      counterparty: 'Imobiliária',
      amount: 1800,
      dueDate: '2026-07-10',
      categoryId: 'category-1',
      recurrenceFrequency: RecurrenceFrequency.MONTHLY,
      recurrenceEndDate: '2026-09-10',
    });

    expect(result.generated).toBe(3);
    expect(prisma.businessEntry.create).toHaveBeenCalledTimes(3);
  });

  it('calcula valores previstos separadamente do realizado', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    const { prisma, service } = serviceFixture();
    prisma.transaction.groupBy.mockResolvedValue([
      { type: TransactionType.INCOME, _sum: { netAmount: 3000 } },
      { type: TransactionType.EXPENSE, _sum: { netAmount: 1000 } },
    ]);

    const summary = await service.summary('user-1');

    expect(summary.availableBalance).toBe(5000);
    expect(summary.monthIncome).toBe(3000);
    expect(summary.monthExpense).toBe(1000);
    expect(summary.receivable).toBe(1500);
    expect(summary.payable).toBe(600);
    expect(summary.estimatedResult).toBe(2900);
    expect(summary.projections.find((item) => item.days === 7)?.balance).toBe(5900);
    vi.useRealTimers();
  });
});
