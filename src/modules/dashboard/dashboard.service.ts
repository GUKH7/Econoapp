import { Inject, Injectable } from '@nestjs/common';
import { FinancialScope, Prisma } from '@prisma/client';
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
  spendingByTime: SpendingByTime;
}

interface SpendingTimeRow { period: string; categoryName: string; total: number; transactionCount: number; }
export interface SpendingByTime {
  sampleSize: number;
  hasEnoughData: boolean;
  peakPeriod: string | null;
  periods: Array<{ key: string; label: string; range: string; total: number; transactionCount: number; percentage: number; topCategory: string | null; topCategoryTotal: number }>;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getSummary(
    userId: string,
    startDate?: string,
    endDate?: string,
    scope?: FinancialScope,
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
    const scopeWhere = scope ? { scope } : {};

    // ── Fase 1: todas as queries independentes em paralelo ───────────────────
    const [incomeAgg, expenseAgg, categoryGroups, channelGroups, cashFlowRaw, spendingTimeRaw] = await Promise.all([
      // Soma das receitas
      this.prisma.transaction.aggregate({
        where: { userId, type: 'INCOME', ...dateWhere, ...scopeWhere },
        _sum: { amount: true, netAmount: true },
      }),

      // Soma das despesas
      this.prisma.transaction.aggregate({
        where: { userId, type: 'EXPENSE', ...dateWhere, ...scopeWhere },
        _sum: { amount: true, netAmount: true },
      }),

      // Agrupamento por categoria
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, ...dateWhere, ...scopeWhere },
        _sum: { amount: true },
      }),

      // Agrupamento por canal
      this.prisma.transaction.groupBy({
        by: ['channelId'],
        where: { userId, ...dateWhere, ...scopeWhere },
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
            ${scope ? Prisma.sql`AND "scope" = ${scope}::"FinancialScope"` : Prisma.empty}
            GROUP BY DATE("date" AT TIME ZONE 'UTC')
            ORDER BY date ASC
          `,
      ),
      this.prisma.$queryRaw<SpendingTimeRow[]>(Prisma.sql`
        SELECT
          CASE
            WHEN EXTRACT(HOUR FROM t."date" AT TIME ZONE 'America/Sao_Paulo') < 6 THEN 'DAWN'
            WHEN EXTRACT(HOUR FROM t."date" AT TIME ZONE 'America/Sao_Paulo') < 12 THEN 'MORNING'
            WHEN EXTRACT(HOUR FROM t."date" AT TIME ZONE 'America/Sao_Paulo') < 18 THEN 'AFTERNOON'
            ELSE 'EVENING'
          END AS period,
          c."name" AS "categoryName",
          SUM(t."amount")::float AS total,
          COUNT(t."id")::int AS "transactionCount"
        FROM "Transaction" t
        INNER JOIN "Category" c ON c."id" = t."categoryId"
        WHERE t."userId" = ${userId}::uuid
          AND t."type" = 'EXPENSE'::"TransactionType"
          AND t."source" NOT IN ('CSV'::"TransactionSource", 'RECURRENT'::"TransactionSource")
          ${startDate ? Prisma.sql`AND t."date" >= ${startOfDayUtc(toUtcDate(startDate))}` : Prisma.empty}
          ${endDate ? Prisma.sql`AND t."date" <= ${endOfDayUtc(toUtcDate(endDate))}` : Prisma.empty}
          ${scope ? Prisma.sql`AND t."scope" = ${scope}::"FinancialScope"` : Prisma.empty}
        GROUP BY period, c."name"
      `),
    ]);

    // ── Totais ───────────────────────────────────────────────────────────────
    const totalIncome = Number(incomeAgg._sum.amount ?? 0);
    const totalExpense = Number(expenseAgg._sum.amount ?? 0);
    const netIncome = Number(incomeAgg._sum.netAmount ?? 0);
    const netExpense = Number(expenseAgg._sum.netAmount ?? 0);
    const balance = netIncome - netExpense;

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
    const spendingByTime = buildSpendingByTime(spendingTimeRaw);

    return { balance, totalIncome, totalExpense, byCategory, byChannel, cashFlow, spendingByTime };
  }
}

export function buildSpendingByTime(rows: SpendingTimeRow[]): SpendingByTime {
  const definitions = [
    { key: 'DAWN', label: 'Madrugada', range: '0h às 5h59' },
    { key: 'MORNING', label: 'Manhã', range: '6h às 11h59' },
    { key: 'AFTERNOON', label: 'Tarde', range: '12h às 17h59' },
    { key: 'EVENING', label: 'Noite', range: '18h às 23h59' },
  ];
  const sampleSize = rows.reduce((sum, row) => sum + Number(row.transactionCount || 0), 0);
  const grandTotal = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const periods = definitions.map((definition) => {
    const periodRows = rows.filter((row) => row.period === definition.key);
    const total = periodRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const transactionCount = periodRows.reduce((sum, row) => sum + Number(row.transactionCount || 0), 0);
    const top = [...periodRows].sort((left, right) => Number(right.total) - Number(left.total))[0];
    return { ...definition, total, transactionCount, percentage: grandTotal > 0 ? Number(((total / grandTotal) * 100).toFixed(1)) : 0, topCategory: top?.categoryName ?? null, topCategoryTotal: Number(top?.total ?? 0) };
  });
  const peak = [...periods].sort((left, right) => right.total - left.total)[0];
  return { sampleSize, hasEnoughData: sampleSize >= 5, peakPeriod: peak && peak.total > 0 ? peak.key : null, periods };
}
