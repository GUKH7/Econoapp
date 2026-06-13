import { Inject, Injectable } from '@nestjs/common';
import { FinancialScope, TransactionType } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@/common/errors/app.exception';
import { PrismaService } from '@/config/database';
import { UpsertCategoryBudgetDto } from './dto/upsert-category-budget.dto';

@Injectable()
export class BudgetService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCurrentMonth(userId: string, scopeValue?: string) {
    const scope = this.parseScope(scopeValue);
    const { start, end } = this.currentMonthRange();
    const [budgets, expenseGroups] = await Promise.all([
      this.prisma.categoryBudget.findMany({
        where: { userId, scope, month: start },
        include: { category: true },
        orderBy: { category: { name: 'asc' } },
      }),
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          scope,
          type: TransactionType.EXPENSE,
          date: { gte: start, lt: end },
        },
        _sum: { netAmount: true },
      }),
    ]);
    const spentByCategory = new Map(
      expenseGroups.map((item) => [item.categoryId, Number(item._sum.netAmount ?? 0)]),
    );
    const items = budgets.map((budget) => {
      const amount = Number(budget.amount);
      const spent = spentByCategory.get(budget.categoryId) ?? 0;
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        categoryName: budget.category.name,
        categoryColor: budget.category.color,
        scope: budget.scope,
        month: budget.month,
        amount,
        spent,
        percentage: amount > 0 ? Math.round((spent / amount) * 100) : 0,
      };
    });
    return {
      scope,
      month: start,
      totalLimit: items.reduce((sum, item) => sum + item.amount, 0),
      totalSpent: items.reduce((sum, item) => sum + item.spent, 0),
      items,
    };
  }

  async upsert(userId: string, input: UpsertCategoryBudgetDto) {
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, userId },
    });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    const month = this.currentMonthRange().start;
    return this.prisma.categoryBudget.upsert({
      where: {
        userId_categoryId_scope_month: {
          userId,
          categoryId: input.categoryId,
          scope: input.scope,
          month,
        },
      },
      create: {
        userId,
        categoryId: input.categoryId,
        scope: input.scope,
        month,
        amount: input.amount,
      },
      update: { amount: input.amount, alertLevel: 0, lastAlertAt: null },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const budget = await this.prisma.categoryBudget.findFirst({ where: { id, userId } });
    if (!budget) throw new NotFoundException('Orçamento não encontrado');
    await this.prisma.categoryBudget.delete({ where: { id } });
  }

  private parseScope(value?: string): FinancialScope {
    if (!value) return FinancialScope.PERSONAL;
    if (!Object.values(FinancialScope).includes(value as FinancialScope)) {
      throw new BadRequestException('Modo financeiro inválido');
    }
    return value as FinancialScope;
  }

  private currentMonthRange(): { start: Date; end: Date } {
    const now = new Date();
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }
}
