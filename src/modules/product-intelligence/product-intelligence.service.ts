import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessEntryStatus,
  BusinessEntryType,
  DinInsightStatus,
  DinInsightType,
  FinancialScope,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '@/config/database';
import { InsightAction, InsightActionDto } from './dto/insight-action.dto';
import { UpdateAssistantPreferenceDto } from './dto/update-assistant-preference.dto';

const DAY_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class ProductIntelligenceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async preferences(userId: string) {
    return this.prisma.assistantPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updatePreferences(userId: string, input: UpdateAssistantPreferenceDto) {
    this.validateTimezone(input.timezone);
    return this.prisma.assistantPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
  }

  async refresh(userId: string, now = new Date()) {
    const [anomalies, forecast, obligations] = await Promise.all([
      this.detectAnomalies(userId, now),
      this.createForecastInsight(userId, now),
      this.createObligationInsights(userId, now),
    ]);
    return { anomalies, forecast, obligations };
  }

  async refreshActiveUsers(now = new Date()): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: { accessStatus: 'ACTIVE' },
      select: { id: true },
      take: 500,
    });
    for (const user of users) {
      const preference = await this.preferences(user.id);
      if (preference.proactiveAlertsEnabled) await this.refresh(user.id, now);
    }
    return users.length;
  }

  async list(userId: string, refresh = false) {
    if (refresh) await this.refresh(userId);
    const now = new Date();
    await this.prisma.dinInsight.updateMany({
      where: { userId, status: DinInsightStatus.ACTIVE, expiresAt: { lt: now } },
      data: { status: DinInsightStatus.EXPIRED },
    });
    return this.prisma.dinInsight.findMany({
      where: {
        userId,
        OR: [
          { status: DinInsightStatus.ACTIVE },
          { status: DinInsightStatus.REMINDED, remindAt: { lte: now } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 30,
    });
  }

  async forecast(userId: string, scope?: FinancialScope, now = new Date()) {
    const historyStart = new Date(now.getTime() - 60 * DAY_MS);
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const daysObserved = Math.max(1, Math.ceil((tomorrow.getTime() - historyStart.getTime()) / DAY_MS));
    const daysRemaining = Math.max(0, Math.ceil((monthEnd.getTime() - tomorrow.getTime()) / DAY_MS));
    const scopeWhere = scope ? { scope } : {};

    const [history, allTime, pending] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { gte: historyStart, lt: tomorrow }, ...scopeWhere },
        _sum: { netAmount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { lt: tomorrow }, ...scopeWhere },
        _sum: { netAmount: true },
      }),
      this.prisma.businessEntry.groupBy({
        by: ['type'],
        where: {
          userId,
          status: BusinessEntryStatus.PENDING,
          dueDate: { gte: tomorrow, lt: monthEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const historyIncome = this.groupTotal(history, TransactionType.INCOME);
    const historyExpense = this.groupTotal(history, TransactionType.EXPENSE);
    const currentBalance = this.groupTotal(allTime, TransactionType.INCOME) - this.groupTotal(allTime, TransactionType.EXPENSE);
    const dailyIncome = historyIncome / daysObserved;
    const dailyExpense = historyExpense / daysObserved;
    const expectedIncome = dailyIncome * daysRemaining;
    const expectedExpense = dailyExpense * daysRemaining;
    const receivable = this.groupTotal(pending, BusinessEntryType.RECEIVABLE);
    const payable = this.groupTotal(pending, BusinessEntryType.PAYABLE);
    const projectedBalance = currentBalance + expectedIncome - expectedExpense + receivable - payable;

    return {
      scope: scope ?? null,
      currentBalance: this.round(currentBalance),
      projectedBalance: this.round(projectedBalance),
      components: {
        expectedIncome: this.round(expectedIncome),
        expectedExpense: this.round(expectedExpense),
        receivable: this.round(receivable),
        payable: this.round(payable),
        daysObserved,
        daysRemaining,
      },
      explanation: {
        method: 'MEDIA_DIARIA_60_DIAS',
        formula: 'saldo atual + entradas esperadas - saídas esperadas + contas a receber - contas a pagar',
        calculation: `${this.round(currentBalance)} + ${this.round(expectedIncome)} - ${this.round(expectedExpense)} + ${this.round(receivable)} - ${this.round(payable)} = ${this.round(projectedBalance)}`,
        caveats: [
          'A média usa somente lançamentos registrados nos últimos 60 dias.',
          'Contas empresariais pendentes entram apenas quando vencem até o fim do mês.',
          'A previsão muda quando novos lançamentos ou vencimentos são cadastrados.',
        ],
      },
    };
  }

  async act(userId: string, insightId: string, input: InsightActionDto) {
    const insight = await this.prisma.dinInsight.findFirst({ where: { id: insightId, userId } });
    if (!insight) throw new NotFoundException('Sugestão não encontrada.');
    if (
      insight.status === DinInsightStatus.DISMISSED ||
      insight.status === DinInsightStatus.ACTED ||
      insight.status === DinInsightStatus.EXPIRED
    ) {
      throw new BadRequestException('Esta sugestão não está mais disponível.');
    }

    if (input.action === InsightAction.IGNORE) {
      return this.prisma.dinInsight.update({
        where: { id: insight.id },
        data: { status: DinInsightStatus.DISMISSED, dismissedAt: new Date() },
      });
    }
    if (input.action === InsightAction.REMIND_LATER) {
      return this.prisma.dinInsight.update({
        where: { id: insight.id },
        data: {
          status: DinInsightStatus.REMINDED,
          remindAt: new Date(Date.now() + (input.remindInHours ?? 24) * 60 * 60_000),
          lastNotifiedAt: null,
        },
      });
    }

    const payload = this.asRecord(insight.actionPayload);
    const categoryId = String(payload?.categoryId ?? '');
    const amount = Number(payload?.amount ?? 0);
    const scope = payload?.scope === FinancialScope.BUSINESS ? FinancialScope.BUSINESS : FinancialScope.PERSONAL;
    if (!categoryId || !Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('A sugestão não possui dados suficientes para criar um orçamento.');
    }
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
    if (!category) throw new BadRequestException('A categoria da sugestão não existe mais.');
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    await this.prisma.categoryBudget.upsert({
      where: { userId_categoryId_scope_month: { userId, categoryId, scope, month } },
      create: { userId, categoryId, scope, month, amount },
      update: { amount, alertLevel: 0, lastAlertAt: null },
    });
    return this.prisma.dinInsight.update({
      where: { id: insight.id },
      data: { status: DinInsightStatus.ACTED, actedAt: new Date() },
    });
  }

  async deliverable(now = new Date()) {
    const weekStart = new Date(now.getTime() - 7 * DAY_MS);
    const users = await this.prisma.user.findMany({
      where: { accessStatus: 'ACTIVE' },
      select: { id: true, phone: true, assistantPreference: true },
    });
    const output: Array<{ userId: string; phone: string; insightId: string; message: string }> = [];
    for (const user of users) {
      const preference = user.assistantPreference ?? await this.preferences(user.id);
      if (!preference.proactiveAlertsEnabled || this.inQuietHours(now, preference.timezone, preference.quietHoursStart, preference.quietHoursEnd)) continue;
      const sent = await this.prisma.dinInsight.count({
        where: { userId: user.id, lastNotifiedAt: { gte: weekStart } },
      });
      if (sent >= preference.maxWeeklyAlerts) continue;
      const candidates = await this.prisma.dinInsight.findMany({
        where: {
          userId: user.id,
          lastNotifiedAt: null,
          OR: [
            { status: DinInsightStatus.ACTIVE },
            { status: DinInsightStatus.REMINDED, remindAt: { lte: now } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const insight = candidates.find((item) => {
        if (item.type === DinInsightType.ANOMALOUS_EXPENSE) return preference.anomalyAlertsEnabled;
        if (item.type === DinInsightType.BALANCE_FORECAST) return preference.forecastAlertsEnabled;
        return true;
      });
      if (!insight) continue;
      output.push({
        userId: user.id,
        phone: user.phone,
        insightId: insight.id,
        message: `${insight.title}\n${insight.summary}\n\nVocê pode escolher: Criar orçamento, Lembrar depois ou Ignorar.`,
      });
    }
    return output;
  }

  async markNotified(id: string, now = new Date()) {
    await this.prisma.dinInsight.update({ where: { id }, data: { lastNotifiedAt: now } });
  }

  private async detectAnomalies(userId: string, now: Date) {
    const start = new Date(now.getTime() - 90 * DAY_MS);
    const recentLimit = new Date(now.getTime() - 7 * DAY_MS);
    const rows = await this.prisma.transaction.findMany({
      where: { userId, type: TransactionType.EXPENSE, date: { gte: start, lte: now } },
      select: { id: true, description: true, amount: true, date: true, categoryId: true, scope: true, category: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });
    const created = [];
    for (const current of rows.filter((row) => row.date >= recentLimit)) {
      const baseline = rows
        .filter((row) => row.id !== current.id && row.categoryId === current.categoryId && row.date < current.date)
        .slice(0, 30)
        .map((row) => Number(row.amount));
      if (baseline.length < 4) continue;
      const average = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
      const variance = baseline.reduce((sum, value) => sum + (value - average) ** 2, 0) / baseline.length;
      const deviation = Math.sqrt(variance);
      const amount = Number(current.amount);
      const score = deviation > 0 ? (amount - average) / deviation : amount > average ? 99 : 0;
      if (amount < average * 1.75 || amount - average < 20 || score < 2) continue;
      const proposedBudget = Math.ceil((average * 1.2) / 10) * 10;
      const insight = await this.prisma.dinInsight.upsert({
        where: { fingerprint: `anomaly:${current.id}` },
        create: {
          userId,
          type: DinInsightType.ANOMALOUS_EXPENSE,
          fingerprint: `anomaly:${current.id}`,
          title: `Gasto fora do padrão em ${current.category.name}`,
          summary: `${current.description}: ${this.money(amount)}, cerca de ${Math.round((amount / average - 1) * 100)}% acima da média recente.`,
          explanation: {
            method: 'MEDIA_E_DESVIO_DA_CATEGORIA',
            sampleSize: baseline.length,
            average: this.round(average),
            standardDeviation: this.round(deviation),
            observed: amount,
            score: this.round(score),
            rule: 'valor >= 1,75x a média, diferença >= R$ 20 e pelo menos 2 desvios acima',
          },
          metadata: { transactionId: current.id, categoryId: current.categoryId, scope: current.scope },
          suggestedAction: InsightAction.CREATE_BUDGET,
          actionPayload: { categoryId: current.categoryId, amount: proposedBudget, scope: current.scope },
          expiresAt: new Date(now.getTime() + 30 * DAY_MS),
        },
        update: {},
      });
      created.push(insight);
    }
    return created;
  }

  private async createForecastInsight(userId: string, now: Date) {
    const forecast = await this.forecast(userId, undefined, now);
    const monthKey = now.toISOString().slice(0, 7);
    return this.prisma.dinInsight.upsert({
      where: { fingerprint: `forecast:${userId}:${monthKey}` },
      create: {
        userId,
        type: DinInsightType.BALANCE_FORECAST,
        fingerprint: `forecast:${userId}:${monthKey}`,
        title: 'Previsão de saldo no fim do mês',
        summary: `Mantido o ritmo atual, o saldo projetado é ${this.money(forecast.projectedBalance)}.`,
        explanation: forecast.explanation as unknown as Prisma.InputJsonValue,
        metadata: forecast as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2)),
      },
      update: {
        summary: `Mantido o ritmo atual, o saldo projetado é ${this.money(forecast.projectedBalance)}.`,
        explanation: forecast.explanation as unknown as Prisma.InputJsonValue,
        metadata: forecast as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async createObligationInsights(userId: string, now: Date) {
    const limit = new Date(now.getTime() + 3 * DAY_MS);
    const entries = await this.prisma.businessEntry.findMany({
      where: { userId, status: BusinessEntryStatus.PENDING, dueDate: { lte: limit } },
      select: { id: true, type: true, title: true, counterparty: true, amount: true, dueDate: true },
    });
    return Promise.all(entries.map((entry) => {
      const receivable = entry.type === BusinessEntryType.RECEIVABLE;
      return this.prisma.dinInsight.upsert({
        where: { fingerprint: `obligation:${entry.id}:${entry.dueDate.toISOString().slice(0, 10)}` },
        create: {
          userId,
          type: receivable ? DinInsightType.RECEIVABLE_REMINDER : DinInsightType.PAYABLE_REMINDER,
          fingerprint: `obligation:${entry.id}:${entry.dueDate.toISOString().slice(0, 10)}`,
          title: receivable ? 'Cobrança de cliente próxima' : 'Pagamento de fornecedor próximo',
          summary: `${entry.title}: ${this.money(Number(entry.amount))} ${receivable ? 'a receber de' : 'a pagar para'} ${entry.counterparty} em ${entry.dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`,
          explanation: { source: 'CONTA_EMPRESARIAL', entryId: entry.id, dueDate: entry.dueDate.toISOString() },
          metadata: { entryId: entry.id, counterparty: entry.counterparty },
          expiresAt: new Date(entry.dueDate.getTime() + 7 * DAY_MS),
        },
        update: {},
      });
    }));
  }

  private groupTotal(rows: Array<Record<string, unknown>>, type: string): number {
    const row = rows.find((item) => item.type === type) as { _sum?: { netAmount?: unknown; amount?: unknown } } | undefined;
    return Number(row?._sum?.netAmount ?? row?._sum?.amount ?? 0);
  }

  private validateTimezone(timezone?: string): void {
    if (!timezone) return;
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date()); }
    catch { throw new BadRequestException('Fuso horário inválido.'); }
  }

  private inQuietHours(now: Date, timezone: string, start: number, end: number): boolean {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private money(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private round(value: number): number { return Math.round(value * 100) / 100; }
}
