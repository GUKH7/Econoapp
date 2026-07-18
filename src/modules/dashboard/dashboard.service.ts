import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { FinancialScope, Prisma, TransactionType } from '@prisma/client';
import { FinancialReportResponse } from '@/common/types/response.types';
import { PrismaService } from '@/config/database';
import { startOfDayUtc, endOfDayUtc, toUtcDate } from '@/utils/date';

interface DashboardSummary {
  balance: number;
  totalIncome: number;
  totalExpense: number;
  byCategory: Array<{ type: TransactionType; categoryName: string; color: string; total: number; percentage: number }>;
  byChannel: Array<{
    type: TransactionType;
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

  async getReport(
    userId: string,
    startDate: string,
    endDate: string,
    scope?: FinancialScope,
  ): Promise<FinancialReportResponse> {
    const periodStart = startOfDayUtc(toUtcDate(startDate));
    const periodEnd = endOfDayUtc(toUtcDate(endDate));
    if (periodStart > periodEnd) {
      throw new BadRequestException('A data inicial deve ser anterior à data final');
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const periodDays = Math.round((startOfDayUtc(periodEnd).getTime() - periodStart.getTime()) / dayMs) + 1;
    const comparisonEnd = endOfDayUtc(new Date(periodStart.getTime() - dayMs));
    const lastDayOfPeriodMonth = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0)).getUTCDate();
    const isFullMonth = periodStart.getUTCDate() === 1 && periodEnd.getUTCDate() === lastDayOfPeriodMonth;
    const comparisonStart = isFullMonth
      ? new Date(Date.UTC(comparisonEnd.getUTCFullYear(), comparisonEnd.getUTCMonth(), 1))
      : startOfDayUtc(new Date(comparisonEnd.getTime() - (periodDays - 1) * dayMs));
    const scopeWhere = scope ? { scope } : {};

    const [currentGroups, previousGroups, categoryGroups, spendingTimeRaw] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { gte: periodStart, lte: periodEnd }, ...scopeWhere },
        _sum: { netAmount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { gte: comparisonStart, lte: comparisonEnd }, ...scopeWhere },
        _sum: { netAmount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['type', 'categoryId'],
        where: { userId, date: { gte: periodStart, lte: periodEnd }, ...scopeWhere },
        _sum: { netAmount: true },
      }),
      this.prisma.$queryRaw<SpendingTimeRow[]>(Prisma.sql`
        SELECT
          CASE
            WHEN EXTRACT(HOUR FROM t."date" AT TIME ZONE 'America/Sao_Paulo') < 6 THEN 'DAWN'
            WHEN EXTRACT(HOUR FROM t."date" AT TIME ZONE 'America/Sao_Paulo') < 12 THEN 'MORNING'
            WHEN EXTRACT(HOUR FROM t."date" AT TIME ZONE 'America/Sao_Paulo') < 18 THEN 'AFTERNOON'
            ELSE 'EVENING'
          END AS period,
          c."name" AS "categoryName",
          SUM(t."netAmount")::float AS total,
          COUNT(t."id")::int AS "transactionCount"
        FROM "Transaction" t
        INNER JOIN "Category" c ON c."id" = t."categoryId"
        WHERE t."userId" = ${userId}::uuid
          AND t."type" = 'EXPENSE'::"TransactionType"
          AND t."source" NOT IN ('CSV'::"TransactionSource", 'RECURRENT'::"TransactionSource")
          AND t."date" >= ${periodStart}
          AND t."date" <= ${periodEnd}
          ${scope ? Prisma.sql`AND t."scope" = ${scope}::"FinancialScope"` : Prisma.empty}
        GROUP BY period, c."name"
      `),
    ]);

    const categoryIds = categoryGroups.map((group) => group.categoryId);
    const categoryRecords = await this.prisma.category.findMany({
      where: { userId, id: { in: categoryIds } },
      select: { id: true, name: true, color: true },
    });
    const categoryMap = new Map(categoryRecords.map((category) => [category.id, category]));

    return {
      period: { startDate: dateKey(periodStart), endDate: dateKey(periodEnd) },
      comparisonPeriod: { startDate: dateKey(comparisonStart), endDate: dateKey(comparisonEnd) },
      current: reportTotals(currentGroups),
      previous: reportTotals(previousGroups),
      categories: {
        INCOME: reportCategories(categoryGroups, categoryMap, TransactionType.INCOME),
        EXPENSE: reportCategories(categoryGroups, categoryMap, TransactionType.EXPENSE),
      },
      spendingByTime: buildSpendingByTime(spendingTimeRaw),
    };
  }

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
        by: ['type', 'categoryId'],
        where: { userId, ...dateWhere, ...scopeWhere },
        _sum: { amount: true },
      }),

      // Agrupamento por canal
      this.prisma.transaction.groupBy({
        by: ['type', 'channelId'],
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
        where: { userId, id: { in: categoryIds } },
        select: { id: true, name: true, color: true },
      }),
      this.prisma.salesChannel.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, name: true },
      }),
    ]);

    // ── byCategory ───────────────────────────────────────────────────────────
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const categoryTotalsByType = new Map<TransactionType, number>();
    categoryGroups.forEach((group) => {
      categoryTotalsByType.set(
        group.type,
        (categoryTotalsByType.get(group.type) ?? 0) + Number(group._sum.amount ?? 0),
      );
    });
    const byCategory = categoryGroups.map((g) => {
      const cat = categoryMap.get(g.categoryId);
      const total = Number(g._sum.amount ?? 0);
      const totalForType = categoryTotalsByType.get(g.type) ?? 0;
      return {
        type: g.type,
        categoryName: cat?.name ?? 'Desconhecido',
        color: cat?.color ?? '#6366f1',
        total,
        percentage:
          totalForType > 0 ? Number(((total / totalForType) * 100).toFixed(2)) : 0,
      };
    });

    // ── byChannel ────────────────────────────────────────────────────────────
    const channelNameMap = new Map(channels.map((c) => [c.id, c.name]));
    const byChannel = channelGroups.map((g) => ({
      type: g.type,
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

type ReportTotalGroup = {
  type: TransactionType;
  _sum: { netAmount: Prisma.Decimal | number | null };
};
type ReportCategoryGroup = ReportTotalGroup & { categoryId: string };
type ReportCategoryRecord = { id: string; name: string; color: string };

function reportTotals(groups: ReportTotalGroup[]): { income: number; expense: number; balance: number } {
  const income = Number(groups.find((group) => group.type === TransactionType.INCOME)?._sum.netAmount ?? 0);
  const expense = Number(groups.find((group) => group.type === TransactionType.EXPENSE)?._sum.netAmount ?? 0);
  return { income, expense, balance: income - expense };
}

function reportCategories(
  groups: ReportCategoryGroup[],
  categoryMap: Map<string, ReportCategoryRecord>,
  type: TransactionType,
): Array<{ name: string; color: string; total: number; percentage: number }> {
  const selected = groups
    .filter((group) => group.type === type)
    .map((group) => {
      const category = categoryMap.get(group.categoryId);
      return {
        name: category?.name ?? 'Desconhecido',
        color: category?.color ?? '#6366f1',
        total: Number(group._sum.netAmount ?? 0),
        percentage: 0,
      };
    })
    .sort((left, right) => right.total - left.total);
  const total = selected.reduce((sum, category) => sum + category.total, 0);
  return selected.map((category) => ({
    ...category,
    percentage: total > 0 ? Number(((category.total / total) * 100).toFixed(2)) : 0,
  }));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
