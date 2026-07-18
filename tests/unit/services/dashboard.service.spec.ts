import { FinancialScope, TransactionType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { buildSpendingByTime, DashboardService } from '@/modules/dashboard/dashboard.service';

describe('buildSpendingByTime', () => {
  it('identifica o horário e a categoria em que o usuário mais gasta', () => {
    const result = buildSpendingByTime([
      { period: 'MORNING', categoryName: 'Transporte', total: 50, transactionCount: 2 },
      { period: 'EVENING', categoryName: 'Alimentação', total: 180, transactionCount: 3 },
      { period: 'EVENING', categoryName: 'Lazer', total: 70, transactionCount: 1 },
    ]);
    expect(result.sampleSize).toBe(6);
    expect(result.hasEnoughData).toBe(true);
    expect(result.peakPeriod).toBe('EVENING');
    expect(result.periods.find((period) => period.key === 'EVENING')).toMatchObject({ total: 250, transactionCount: 4, topCategory: 'Alimentação' });
  });

  it('não afirma um hábito com uma amostra pequena', () => {
    const result = buildSpendingByTime([{ period: 'AFTERNOON', categoryName: 'Saúde', total: 40, transactionCount: 2 }]);
    expect(result.hasEnoughData).toBe(false);
    expect(result.periods).toHaveLength(4);
  });
});

describe('DashboardService.getSummary', () => {
  it('mantém receitas e despesas separadas nos agrupamentos', async () => {
    const groupBy = vi.fn()
      .mockResolvedValueOnce([
        { type: TransactionType.INCOME, categoryId: 'shared', _sum: { amount: 1000 } },
        { type: TransactionType.EXPENSE, categoryId: 'shared', _sum: { amount: 400 } },
        { type: TransactionType.EXPENSE, categoryId: 'travel', _sum: { amount: 600 } },
      ])
      .mockResolvedValueOnce([
        {
          type: TransactionType.INCOME,
          channelId: 'marketplace',
          _sum: { amount: 1000, netAmount: 950 },
          _count: { id: 2 },
        },
        {
          type: TransactionType.EXPENSE,
          channelId: 'marketplace',
          _sum: { amount: 200, netAmount: 200 },
          _count: { id: 1 },
        },
      ]);
    const prisma = {
      transaction: {
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { amount: 1000, netAmount: 950 } })
          .mockResolvedValueOnce({ _sum: { amount: 1000, netAmount: 1000 } }),
        groupBy,
      },
      category: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'shared', name: 'Geral', color: '#00D19A' },
          { id: 'travel', name: 'Viagem', color: '#8B5CF6' },
        ]),
      },
      salesChannel: {
        findMany: vi.fn().mockResolvedValue([{ id: 'marketplace', name: 'Marketplace' }]),
      },
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const service = new DashboardService(prisma as never);

    const summary = await service.getSummary('user-id', '2026-07-01', '2026-07-31');

    expect(summary.byCategory).toEqual([
      { type: TransactionType.INCOME, categoryName: 'Geral', color: '#00D19A', total: 1000, percentage: 100 },
      { type: TransactionType.EXPENSE, categoryName: 'Geral', color: '#00D19A', total: 400, percentage: 40 },
      { type: TransactionType.EXPENSE, categoryName: 'Viagem', color: '#8B5CF6', total: 600, percentage: 60 },
    ]);
    expect(summary.byChannel).toEqual([
      { type: TransactionType.INCOME, channelName: 'Marketplace', total: 1000, netTotal: 950, transactionCount: 2 },
      { type: TransactionType.EXPENSE, channelName: 'Marketplace', total: 200, netTotal: 200, transactionCount: 1 },
    ]);
    expect(groupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({ by: ['type', 'categoryId'] }));
    expect(groupBy).toHaveBeenNthCalledWith(2, expect.objectContaining({ by: ['type', 'channelId'] }));
  });
});

describe('DashboardService.getReport', () => {
  it('agrega o período no servidor e compara com o mês anterior completo', async () => {
    const groupBy = vi.fn()
      .mockResolvedValueOnce([
        { type: TransactionType.INCOME, _sum: { netAmount: 3000 } },
        { type: TransactionType.EXPENSE, _sum: { netAmount: 1250 } },
      ])
      .mockResolvedValueOnce([
        { type: TransactionType.INCOME, _sum: { netAmount: 2500 } },
        { type: TransactionType.EXPENSE, _sum: { netAmount: 1000 } },
      ])
      .mockResolvedValueOnce([
        { type: TransactionType.EXPENSE, categoryId: 'category-food', _sum: { netAmount: 750 } },
        { type: TransactionType.EXPENSE, categoryId: 'category-leisure', _sum: { netAmount: 500 } },
      ]);
    const prisma = {
      transaction: { groupBy },
      category: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'category-food', name: 'Alimentação', color: '#00D19A' },
          { id: 'category-leisure', name: 'Lazer', color: '#8B5CF6' },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        { period: 'EVENING', categoryName: 'Alimentação', total: 750, transactionCount: 6 },
      ]),
    };
    const service = new DashboardService(prisma as never);

    const report = await service.getReport(
      '00000000-0000-0000-0000-000000000001',
      '2026-07-01',
      '2026-07-31',
      FinancialScope.PERSONAL,
    );

    expect(report.period).toEqual({ startDate: '2026-07-01', endDate: '2026-07-31' });
    expect(report.comparisonPeriod).toEqual({ startDate: '2026-06-01', endDate: '2026-06-30' });
    expect(report.current).toEqual({ income: 3000, expense: 1250, balance: 1750 });
    expect(report.previous).toEqual({ income: 2500, expense: 1000, balance: 1500 });
    expect(report.categories.EXPENSE).toEqual([
      { name: 'Alimentação', color: '#00D19A', total: 750, percentage: 60 },
      { name: 'Lazer', color: '#8B5CF6', total: 500, percentage: 40 },
    ]);
    expect(report.spendingByTime.peakPeriod).toBe('EVENING');
    expect(groupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        scope: FinancialScope.PERSONAL,
        date: { gte: new Date('2026-07-01T00:00:00.000Z'), lte: new Date('2026-07-31T23:59:59.999Z') },
      }),
    }));
  });

  it('rejeita um período invertido antes de consultar o banco', async () => {
    const service = new DashboardService({} as never);
    await expect(service.getReport('user-id', '2026-07-31', '2026-07-01')).rejects.toThrow(
      'A data inicial deve ser anterior à data final',
    );
  });
});
