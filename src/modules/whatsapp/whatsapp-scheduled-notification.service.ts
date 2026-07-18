import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessEntryStatus,
  BusinessEntryType,
  FinancialScope,
  ScheduledNotificationType,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '@/config/database';
import { WhatsappService } from './whatsapp.service';

export interface ScheduledNotificationResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class WhatsappScheduledNotificationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WhatsappService) private readonly whatsappService: WhatsappService,
  ) {}

  async run(referenceDate = new Date()): Promise<ScheduledNotificationResult> {
    const result: ScheduledNotificationResult = { checked: 0, sent: 0, skipped: 0, failed: 0 };
    await this.processUpcomingExpenses(referenceDate, result);
    await this.processCreditCardDueDates(referenceDate, result);
    await this.processBusinessEntries(referenceDate, result);
    return result;
  }

  private async processBusinessEntries(
    referenceDate: Date,
    result: ScheduledNotificationResult,
  ): Promise<void> {
    const start = this.startOfUtcDay(referenceDate);
    const end = this.addUtcDays(start, 4);
    const entries = await this.prisma.businessEntry.findMany({
      where: { status: BusinessEntryStatus.PENDING, dueDate: { lt: end } },
      include: { user: { select: { phone: true } } },
      orderBy: { dueDate: 'asc' },
    });

    for (const entry of entries) {
      const daysUntilDue = this.daysBetween(start, entry.dueDate);
      if (daysUntilDue > 3) continue;
      result.checked += 1;
      const notificationDay = daysUntilDue < 0 ? 'overdue' : String(daysUntilDue);
      const type = entry.type === BusinessEntryType.RECEIVABLE
        ? ScheduledNotificationType.BUSINESS_RECEIVABLE_DUE
        : ScheduledNotificationType.BUSINESS_PAYABLE_DUE;
      const direction = entry.type === BusinessEntryType.RECEIVABLE ? 'receber de' : 'pagar a';
      const timing = daysUntilDue < 0
        ? `está vencida há ${Math.abs(daysUntilDue)} dia(s)`
        : daysUntilDue === 0
          ? 'vence hoje'
          : `vence em ${daysUntilDue} dia(s)`;
      await this.deliver({
        userId: entry.userId,
        phone: entry.user.phone,
        type,
        notificationKey: [type, entry.id, this.dateKey(entry.dueDate), notificationDay].join(':'),
        dueDate: entry.dueDate,
        message: [
          `Lembrete do seu negócio: ${entry.title} ${timing}.`,
          `${direction} ${entry.counterparty}: ${this.formatMoney(Number(entry.amount))}.`,
          `Vencimento: ${this.formatDate(entry.dueDate)}.`,
        ].join('\n'),
        result,
      });
    }
  }

  private async processUpcomingExpenses(
    referenceDate: Date,
    result: ScheduledNotificationResult,
  ): Promise<void> {
    const start = this.startOfUtcDay(referenceDate);
    const end = this.addUtcDays(start, 4);
    const transactions = await this.prisma.transaction.findMany({
      where: {
        type: TransactionType.EXPENSE,
        date: { gte: start, lt: end },
      },
      include: {
        user: { select: { phone: true } },
        category: { select: { name: true } },
        account: { select: { name: true } },
        creditCard: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    });

    for (const transaction of transactions) {
      const daysUntilDue = this.daysBetween(start, transaction.date);
      if (daysUntilDue !== 0 && daysUntilDue !== 3) continue;

      result.checked += 1;
      const installment = /\(\d+\/\d+\)\s*$/.test(transaction.description);
      const type = installment
        ? ScheduledNotificationType.INSTALLMENT_DUE
        : ScheduledNotificationType.BILL_DUE;
      const notificationKey = [
        type,
        transaction.id,
        this.dateKey(transaction.date),
        daysUntilDue,
      ].join(':');
      const message = this.expenseReminderMessage({
        description: transaction.description,
        amount: Number(transaction.amount),
        category: transaction.category.name,
        payment: transaction.creditCard?.name || transaction.account?.name || 'Não informado',
        scope: transaction.scope,
        dueDate: transaction.date,
        daysUntilDue,
        installment,
      });

      await this.deliver({
        userId: transaction.userId,
        phone: transaction.user.phone,
        type,
        notificationKey,
        dueDate: transaction.date,
        message,
        result,
      });
    }
  }

  private async processCreditCardDueDates(
    referenceDate: Date,
    result: ScheduledNotificationResult,
  ): Promise<void> {
    const start = this.startOfUtcDay(referenceDate);
    const cards = await this.prisma.creditCard.findMany({
      where: { isActive: true, dueDay: { not: null } },
      include: { user: { select: { phone: true } } },
    });

    for (const card of cards) {
      const dueDate = this.nextDueDate(start, card.dueDay!);
      const daysUntilDue = this.daysBetween(start, dueDate);
      if (daysUntilDue !== 0 && daysUntilDue !== 3) continue;

      result.checked += 1;
      const cycleStart = this.previousMonthSameDay(dueDate);
      const total = await this.prisma.transaction.aggregate({
        where: {
          userId: card.userId,
          creditCardId: card.id,
          type: TransactionType.EXPENSE,
          date: { gt: cycleStart, lte: dueDate },
        },
        _sum: { amount: true },
      });
      const amount = Number(total._sum.amount ?? 0);
      if (amount <= 0) {
        result.skipped += 1;
        continue;
      }

      const notificationKey = [
        ScheduledNotificationType.CREDIT_CARD_DUE,
        card.id,
        this.dateKey(dueDate),
        daysUntilDue,
      ].join(':');
      const message = [
        daysUntilDue === 0
          ? `A fatura do cartão ${card.name} vence hoje`
          : `A fatura do cartão ${card.name} vence em 3 dias`,
        `Valor registrado: ${this.formatMoney(amount)}.`,
        `Vencimento: ${this.formatDate(dueDate)}.`,
        `Modo: ${this.scopeLabel(card.scope)}.`,
      ].join('\n');

      await this.deliver({
        userId: card.userId,
        phone: card.user.phone,
        type: ScheduledNotificationType.CREDIT_CARD_DUE,
        notificationKey,
        dueDate,
        message,
        result,
      });
    }
  }

  private async deliver(input: {
    userId: string;
    phone: string;
    type: ScheduledNotificationType;
    notificationKey: string;
    dueDate: Date;
    message: string;
    result: ScheduledNotificationResult;
  }): Promise<void> {
    const existing = await this.prisma.scheduledNotificationDelivery.findUnique({
      where: { notificationKey: input.notificationKey },
      select: { id: true },
    });
    if (existing) {
      input.result.skipped += 1;
      return;
    }

    try {
      await this.whatsappService.sendMessage({
        phone: this.normalizePhone(input.phone),
        message: input.message,
      });
      await this.prisma.scheduledNotificationDelivery.create({
        data: {
          userId: input.userId,
          type: input.type,
          notificationKey: input.notificationKey,
          dueDate: input.dueDate,
        },
      });
      input.result.sent += 1;
    } catch {
      input.result.failed += 1;
    }
  }

  private expenseReminderMessage(input: {
    description: string;
    amount: number;
    category: string;
    payment: string;
    scope: FinancialScope;
    dueDate: Date;
    daysUntilDue: number;
    installment: boolean;
  }): string {
    const subject = input.installment ? 'parcela' : 'conta';
    return [
      input.daysUntilDue === 0
        ? `Sua ${subject} vence hoje`
        : `Sua ${subject} vence em 3 dias`,
      input.description,
      `Valor: ${this.formatMoney(input.amount)}.`,
      `Vencimento: ${this.formatDate(input.dueDate)}.`,
      `Categoria: ${input.category}.`,
      `Pagamento: ${input.payment}.`,
      `Modo: ${this.scopeLabel(input.scope)}.`,
    ].join('\n');
  }

  private nextDueDate(reference: Date, dueDay: number): Date {
    const current = this.clampedUtcDate(reference.getUTCFullYear(), reference.getUTCMonth(), dueDay);
    return current >= reference
      ? current
      : this.clampedUtcDate(reference.getUTCFullYear(), reference.getUTCMonth() + 1, dueDay);
  }

  private previousMonthSameDay(date: Date): Date {
    return this.clampedUtcDate(date.getUTCFullYear(), date.getUTCMonth() - 1, date.getUTCDate());
  }

  private clampedUtcDate(year: number, month: number, day: number): Date {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private addUtcDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
  }

  private daysBetween(start: Date, end: Date): number {
    return Math.floor((this.startOfUtcDay(end).getTime() - start.getTime()) / 86_400_000);
  }

  private dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  private scopeLabel(scope: FinancialScope): string {
    return scope === FinancialScope.BUSINESS ? 'Negócio' : 'Pessoal';
  }

  private normalizePhone(phone: string): string {
    const normalized = phone.replace(/\D/g, '');
    return normalized.startsWith('55') ? normalized : `55${normalized}`;
  }
}
