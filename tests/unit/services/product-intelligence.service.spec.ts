import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DinInsightStatus, DinInsightType, FinancialScope, TransactionType } from '@prisma/client';
import { ProductIntelligenceService } from '@/modules/product-intelligence/product-intelligence.service';
import { InsightAction } from '@/modules/product-intelligence/dto/insight-action.dto';

describe('ProductIntelligenceService', () => {
  function createPrismaMock() {
    return {
      transaction: { groupBy: vi.fn(), findMany: vi.fn() },
      businessEntry: { groupBy: vi.fn(), findMany: vi.fn() },
      dinInsight: {
        findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
        upsert: vi.fn(), count: vi.fn(),
      },
      category: { findFirst: vi.fn() },
      categoryBudget: { upsert: vi.fn() },
      assistantPreference: { upsert: vi.fn() },
      user: { findMany: vi.fn() },
    };
  }

  let prisma: ReturnType<typeof createPrismaMock>;
  let service: ProductIntelligenceService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ProductIntelligenceService(prisma as never);
  });

  it('projeta saldo com fórmula e componentes auditáveis', async () => {
    prisma.transaction.groupBy
      .mockResolvedValueOnce([
        { type: TransactionType.INCOME, _sum: { netAmount: 6000 } },
        { type: TransactionType.EXPENSE, _sum: { netAmount: 3000 } },
      ])
      .mockResolvedValueOnce([
        { type: TransactionType.INCOME, _sum: { netAmount: 10000 } },
        { type: TransactionType.EXPENSE, _sum: { netAmount: 7000 } },
      ]);
    prisma.businessEntry.groupBy.mockResolvedValue([
      { type: 'RECEIVABLE', _sum: { amount: 500 } },
      { type: 'PAYABLE', _sum: { amount: 200 } },
    ]);

    const result = await service.forecast('user-1', FinancialScope.PERSONAL, new Date('2026-07-21T12:00:00Z'));

    expect(result.currentBalance).toBe(3000);
    expect(result.components.receivable).toBe(500);
    expect(result.components.payable).toBe(200);
    expect(result.explanation.method).toBe('MEDIA_DIARIA_60_DIAS');
    expect(result.explanation.formula).toContain('saldo atual');
    expect(result.projectedBalance).toBeGreaterThan(3000);
  });

  it('detecta gasto realmente fora do padrão e explica o limiar', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { id: 'new', description: 'Mercado grande', amount: 300, date: new Date('2026-07-20'), categoryId: 'cat-1', scope: 'PERSONAL', category: { name: 'Mercado' } },
      ...[50, 55, 45, 52, 48].map((amount, index) => ({
        id: `old-${index}`, description: 'Mercado', amount, date: new Date(`2026-07-${10 - index}`), categoryId: 'cat-1', scope: 'PERSONAL', category: { name: 'Mercado' },
      })),
    ]);
    prisma.dinInsight.upsert.mockImplementation((input: { create: Record<string, unknown> }) => Promise.resolve(input.create));
    const detect = Reflect.get(service, 'detectAnomalies') as (userId: string, now: Date) => Promise<Array<{
      type: DinInsightType;
      explanation: { rule: string };
      suggestedAction: string;
    }>>;

    const insights = await detect.call(service, 'user-1', new Date('2026-07-21T12:00:00Z'));

    expect(insights).toHaveLength(1);
    const insight = insights[0]!;
    expect(insight.type).toBe(DinInsightType.ANOMALOUS_EXPENSE);
    expect(insight.explanation.rule).toContain('1,75x');
    expect(insight.suggestedAction).toBe(InsightAction.CREATE_BUDGET);
  });

  it('cria orçamento somente para categoria pertencente ao usuário', async () => {
    prisma.dinInsight.findFirst.mockResolvedValue({
      id: 'insight-1', userId: 'user-1', status: DinInsightStatus.ACTIVE,
      actionPayload: { categoryId: 'cat-1', amount: 120, scope: 'PERSONAL' },
    });
    prisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
    prisma.categoryBudget.upsert.mockResolvedValue({ id: 'budget-1' });
    prisma.dinInsight.update.mockResolvedValue({ id: 'insight-1', status: DinInsightStatus.ACTED });

    await service.act('user-1', 'insight-1', { action: InsightAction.CREATE_BUDGET });

    expect(prisma.category.findFirst).toHaveBeenCalledWith({ where: { id: 'cat-1', userId: 'user-1' }, select: { id: true } });
    expect(prisma.categoryBudget.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: 'user-1', categoryId: 'cat-1', amount: 120 }),
    }));
  });
});
