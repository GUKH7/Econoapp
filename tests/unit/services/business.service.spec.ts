import { BusinessContactType, BusinessCostType, BusinessEntryStatus, BusinessEntryType, RecurrenceFrequency } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BusinessService } from '@/modules/business/business.service';

function serviceFixture() {
  const prisma = {
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    category: {
      findFirst: vi.fn().mockResolvedValue({ id: 'category-1' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'category-1', name: 'Operação', businessCostType: BusinessCostType.FIXED }]),
    },
    financialAccount: {
      findFirst: vi.fn().mockResolvedValue({ id: 'account-1' }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { balance: 5000 } }),
    },
    transaction: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0, netAmount: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    businessSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    businessContact: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    businessOffering: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
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
          { id: 'r1', type: BusinessEntryType.RECEIVABLE, amount: 1500, dueDate: new Date('2026-07-20T00:00:00.000Z'), categoryId: 'category-1' },
          { id: 'p1', type: BusinessEntryType.PAYABLE, amount: 600, dueDate: new Date('2026-07-22T00:00:00.000Z'), categoryId: 'category-1' },
        ])
        .mockResolvedValueOnce([]),
      updateMany: vi.fn(),
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
    prisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: 3200, netAmount: 3000 } });
    prisma.transaction.groupBy.mockResolvedValue([{ categoryId: 'category-1', _sum: { netAmount: 1000 } }]);

    const summary = await service.summary('user-1');

    expect(summary.availableBalance).toBe(5000);
    expect(summary.monthIncome).toBe(3000);
    expect(summary.monthExpense).toBe(1000);
    expect(summary.statement.channelFees).toBe(200);
    expect(summary.statement.fixedExpenses).toBe(1000);
    expect(summary.receivable).toBe(1500);
    expect(summary.payable).toBe(600);
    expect(summary.estimatedResult).toBe(2900);
    expect(summary.resultLabel).toBe('Resultado do mês');
    expect(summary.configurationComplete).toBe(false);
    expect(summary.projections.find((item) => item.days === 7)?.balance).toBe(5900);
    vi.useRealTimers();
  });

  it('só chama de lucro líquido quando imposto e custos estão configurados', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    const { prisma, service } = serviceFixture();
    prisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: 3200, netAmount: 3000 } });
    prisma.transaction.groupBy.mockResolvedValue([{ categoryId: 'category-1', _sum: { netAmount: 1000 } }]);
    prisma.businessSettings.findUnique.mockResolvedValue({ taxRate: 6, taxConfigured: true });

    const summary = await service.summary('user-1');

    expect(summary.resultLabel).toBe('Lucro líquido estimado');
    expect(summary.configurationComplete).toBe(true);
    expect(summary.statement.taxProvision).toBe(192);
    expect(summary.statement.pendingTaxProvision).toBe(90);
    expect(summary.statement.estimatedNetResult).toBe(2618);
    vi.useRealTimers();
  });

  it('resume vendas, compras e pendências por contato', async () => {
    const { prisma, service } = serviceFixture();
    prisma.businessContact.findMany.mockResolvedValue([{
      id: 'contact-1', userId: 'user-1', type: 'CLIENT', name: 'João', phone: '11999999999', email: null, notes: null,
      businessEntries: [
        { type: BusinessEntryType.RECEIVABLE, status: BusinessEntryStatus.PENDING, amount: 200, dueDate: new Date('2026-07-20'), settledAt: null, updatedAt: new Date('2026-07-11') },
        { type: BusinessEntryType.RECEIVABLE, status: BusinessEntryStatus.SETTLED, amount: 500, dueDate: new Date('2026-07-10'), settledAt: new Date('2026-07-10'), updatedAt: new Date('2026-07-10') },
      ],
    }]);

    const contacts = await service.listContacts('user-1');

    expect(contacts[0]).toMatchObject({ name: 'João', totalSold: 700, totalPurchased: 0, pendingAmount: 200 });
    expect(contacts[0]?.lastMovementAt).toEqual(new Date('2026-07-11'));
  });

  it('vincula ao novo contato as contas antigas com o mesmo nome', async () => {
    const { prisma, service } = serviceFixture();
    prisma.businessContact.create.mockResolvedValue({ id: 'contact-1', userId: 'user-1', type: 'CLIENT', name: 'João', phone: '11999999999', email: null, notes: null });

    await service.createContact('user-1', { type: BusinessContactType.CLIENT, name: 'João', phone: '11999999999' });

    expect(prisma.businessEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1', contactId: null }),
      data: { contactId: 'contact-1' },
    }));
  });

  it('calcula receita, custo, margem e destaques por produto', async () => {
    const { prisma, service } = serviceFixture();
    prisma.businessOffering.findMany.mockResolvedValue([
      { id: 'p1', name: 'Produto A', type: 'PRODUCT', estimatedUnitCost: 20, transactions: [{ amount: 200, netAmount: 180, quantity: 2, unitCost: 20 }] },
      { id: 'p2', name: 'Produto B', type: 'PRODUCT', estimatedUnitCost: 23, transactions: [{ amount: 300, netAmount: 270, quantity: 10, unitCost: 23 }] },
    ]);

    const report = await service.productReport('user-1');

    expect(report.totals).toMatchObject({ quantity: 12, netRevenue: 450, estimatedCost: 270, margin: 180 });
    expect(report.mostProfitable?.name).toBe('Produto A');
    expect(report.highVolumeLowMargin?.name).toBe('Produto B');
  });
});
