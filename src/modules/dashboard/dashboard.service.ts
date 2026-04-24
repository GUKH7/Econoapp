import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { startOfDayUtc, endOfDayUtc, toUtcDate } from '@/utils/date';

interface DashboardSummary {
  balance: number;
  totalIncome: number;
  totalExpense: number;
  byCategory: Array<{ categoryName: string; color: string; total: number; percentage: number }>;
  byChannel: Array<{
    channelName: string;
    total: number;
    netTotal: number;
    transactionCount: number;
  }>;
  cashFlow: Array<{ date: string; income: number; expense: number }>;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getSummary(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DashboardSummary> {
    const dateWhere =
      startDate || endDate
        ? {
            date: {
              ...(startDate ? { gte: startOfDayUtc(toUtcDate(startDate)) } : {}),
              ...(endDate ? { lte: endOfDayUtc(toUtcDate(endDate)) } : {}),
            },
          }
        : {};

    // ── Fase 1: todas as queries independentes em paralelo ───────────────────
    const [incomeAgg, expenseAgg, categoryGroups, channelGroups, cashFlowRaw] = await Promise.all([
      // Soma das receitas
      this.prisma.transaction.aggregate({
        where: { userId, type: 'INCOME', ...dateWhere },
        _sum: { amount: true },
      }),

      // Soma das despesas
      this.prisma.transaction.aggregate({
        where: { userId, type: 'EXPENSE', ...dateWhere },
        _sum: { amount: true },
      }),

      // Agrupamento por categoria
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, ...dateWhere },
        _sum: { amount: true },
      }),

      // Agrupamento por canal
      this.prisma.transaction.groupBy({
        by: ['channelId'],
        where: { userId, ...dateWhere },
        _sum: { amount: true, netAmount: true },
        _count: { id: true },
      }),

      // Fluxo de caixa diário via SQL bruto (groupBy não suporta expressões de data)
      this.prisma.$queryRaw<Array<{ date: Date; income: number; expense: number }>>(
        Prisma.sql`
            SELECT
              DATE("date" AT TIME ZONE 'UTC') AS date,
              SUM(CASE WHEN type = 'INCOME'  THEN amount ELSE 0 END)::float AS income,
              SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END)::float AS expense
            FROM "Transaction"
            WHERE "userId" = ${userId}::uuid
            ${startDate ? Prisma.sql`AND "date" >= ${startOfDayUtc(toUtcDate(startDate))}` : Prisma.empty}
            ${endDate ? Prisma.sql`AND "date" <= ${endOfDayUtc(toUtcDate(endDate))}` : Prisma.empty}
            GROUP BY DATE("date" AT TIME ZONE 'UTC')
            ORDER BY date ASC
          `,
      ),
    ]);

    // ── Totais ───────────────────────────────────────────────────────────────
    const totalIncome = Number(incomeAgg._sum.amount ?? 0);
    const totalExpense = Number(expenseAgg._sum.amount ?? 0);
    const balance = totalIncome - totalExpense;

    // ── Fase 2: buscar nomes de categorias e canais em paralelo ─────────────
    const categoryIds = categoryGroups.map((g) => g.categoryId);
    const channelIds = channelGroups
      .map((g) => g.channelId)
      .filter((id): id is string => id !== null);

    const [categories, channels] = await Promise.all([
      this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, color: true },
      }),
      this.prisma.salesChannel.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, name: true },
      }),
    ]);

    // ── byCategory ───────────────────────────────────────────────────────────
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const totalAllCategories = categoryGroups.reduce(
      (sum, g) => sum + Number(g._sum.amount ?? 0),
      0,
    );
    const byCategory = categoryGroups.map((g) => {
      const cat = categoryMap.get(g.categoryId);
      const total = Number(g._sum.amount ?? 0);
      return {
        categoryName: cat?.name ?? 'Desconhecido',
        color: cat?.color ?? '#6366f1',
        total,
        percentage:
          totalAllCategories > 0 ? Number(((total / totalAllCategories) * 100).toFixed(2)) : 0,
      };
    });

    // ── byChannel ────────────────────────────────────────────────────────────
    const channelNameMap = new Map(channels.map((c) => [c.id, c.name]));
    const byChannel = channelGroups.map((g) => ({
      channelName: g.channelId ? (channelNameMap.get(g.channelId) ?? 'Desconhecido') : 'Sem canal',
      total: Number(g._sum.amount ?? 0),
      netTotal: Number(g._sum.netAmount ?? 0),
      transactionCount: g._count.id,
    }));

    // ── cashFlow ─────────────────────────────────────────────────────────────
    const cashFlow = cashFlowRaw.map((row) => ({
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
      income: Number(row.income),
      expense: Number(row.expense),
    }));

    return { balance, totalIncome, totalExpense, byCategory, byChannel, cashFlow };
  }
}
