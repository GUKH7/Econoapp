import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancialScope } from '@prisma/client';
import { NotFoundException } from '@/common/errors/app.exception';
import { BudgetService } from '@/modules/budgets/budget.service';

describe('BudgetService', () => {
  let service: BudgetService;
  let prismaMock: {
    categoryBudget: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    transaction: { groupBy: ReturnType<typeof vi.fn> };
    category: { findFirst: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prismaMock = {
      categoryBudget: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
      transaction: { groupBy: vi.fn() },
      category: { findFirst: vi.fn() },
    };
    service = new BudgetService(prismaMock as never);
  });

  it('lista limites e consumo por categoria no mês atual', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    try {
      prismaMock.categoryBudget.findMany.mockResolvedValue([
        {
          id: 'budget-food',
          categoryId: 'food',
          scope: FinancialScope.PERSONAL,
          month: new Date('2026-06-01T00:00:00Z'),
          amount: 500,
          category: { name: 'Alimentação', color: '#22C55E' },
        },
        {
          id: 'budget-transport',
          categoryId: 'transport',
          scope: FinancialScope.PERSONAL,
          month: new Date('2026-06-01T00:00:00Z'),
          amount: 200,
          category: { name: 'Transporte', color: '#3B82F6' },
        },
      ]);
      prismaMock.transaction.groupBy.mockResolvedValue([
        { categoryId: 'food', _sum: { netAmount: 425 } },
        { categoryId: 'transport', _sum: { netAmount: 50 } },
      ]);

      const result = await service.listCurrentMonth('user-1', 'PERSONAL');

      expect(result.totalLimit).toBe(700);
      expect(result.totalSpent).toBe(475);
      expect(result.items[0]).toEqual(
        expect.objectContaining({ categoryName: 'Alimentação', spent: 425, percentage: 85 }),
      );
      expect(prismaMock.transaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            scope: FinancialScope.PERSONAL,
            date: {
              gte: new Date('2026-06-01T00:00:00.000Z'),
              lt: new Date('2026-07-01T00:00:00.000Z'),
            },
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('cria ou atualiza o limite somente para categoria do usuário', async () => {
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'food',
      userId: 'user-1',
      name: 'Alimentação',
    });
    prismaMock.categoryBudget.upsert.mockResolvedValue({ id: 'budget-food' });

    await service.upsert('user-1', {
      categoryId: 'food',
      scope: FinancialScope.PERSONAL,
      amount: 500,
    });

    expect(prismaMock.categoryBudget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'user-1', categoryId: 'food', amount: 500 }),
        update: { amount: 500 },
      }),
    );
  });

  it('rejeita categoria que não pertence ao usuário', async () => {
    prismaMock.category.findFirst.mockResolvedValue(null);

    await expect(
      service.upsert('user-1', {
        categoryId: 'other-category',
        scope: FinancialScope.PERSONAL,
        amount: 500,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.categoryBudget.upsert).not.toHaveBeenCalled();
  });

  it('remove somente orçamento pertencente ao usuário', async () => {
    prismaMock.categoryBudget.findFirst.mockResolvedValue({ id: 'budget-food' });

    await service.remove('user-1', 'budget-food');

    expect(prismaMock.categoryBudget.findFirst).toHaveBeenCalledWith({
      where: { id: 'budget-food', userId: 'user-1' },
    });
    expect(prismaMock.categoryBudget.delete).toHaveBeenCalledWith({
      where: { id: 'budget-food' },
    });
  });
});
