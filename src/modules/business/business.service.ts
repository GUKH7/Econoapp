import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessEntryStatus,
  BusinessEntryType,
  FinancialScope,
  RecurrenceFrequency,
  TransactionSource,
  TransactionType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/config/database';
import { TransactionService } from '@/modules/transactions/transaction.service';
import { CreateBusinessEntryDto } from './dto/create-business-entry.dto';
import { SettleBusinessEntryDto } from './dto/settle-business-entry.dto';
import { UpdateBusinessEntryDto } from './dto/update-business-entry.dto';

@Injectable()
export class BusinessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
  ) {}

  async create(userId: string, input: CreateBusinessEntryDto) {
    await this.validateReferences(userId, input.categoryId, input.accountId);
    const firstDueDate = new Date(input.dueDate);
    const seriesId = input.recurrenceFrequency ? randomUUID() : null;
    const dueDates = this.recurrenceDates(firstDueDate, input.recurrenceFrequency, input.recurrenceEndDate);
    const entries = await this.prisma.$transaction(
      dueDates.map((dueDate) => this.prisma.businessEntry.create({
        data: {
          userId,
          type: input.type,
          title: input.title.trim(),
          counterparty: input.counterparty.trim(),
          amount: input.amount,
          dueDate,
          categoryId: input.categoryId,
          accountId: input.accountId ?? null,
          recurrenceFrequency: input.recurrenceFrequency ?? null,
          recurrenceEndDate: input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null,
          seriesId,
          notes: input.notes?.trim() || null,
        },
        include: this.entryInclude(),
      })),
    );
    return { entry: this.withEffectiveStatus(entries[0]!), generated: entries.length };
  }

  async list(userId: string, type?: BusinessEntryType, status?: BusinessEntryStatus) {
    const entries = await this.prisma.businessEntry.findMany({
      where: { userId, ...(type ? { type } : {}), ...(status ? { status } : {}) },
      include: this.entryInclude(),
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });
    return entries.map((entry) => this.withEffectiveStatus(entry));
  }

  async update(userId: string, id: string, input: UpdateBusinessEntryDto) {
    const entry = await this.findOwned(userId, id);
    if (entry.status !== BusinessEntryStatus.PENDING) {
      throw new BadRequestException('Somente contas pendentes podem ser editadas');
    }
    await this.validateReferences(userId, input.categoryId ?? entry.categoryId, input.accountId);
    const updated = await this.prisma.businessEntry.update({
      where: { id },
      data: {
        ...input,
        ...(input.dueDate ? { dueDate: new Date(input.dueDate) } : {}),
        ...(input.title ? { title: input.title.trim() } : {}),
        ...(input.counterparty ? { counterparty: input.counterparty.trim() } : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      },
      include: this.entryInclude(),
    });
    return this.withEffectiveStatus(updated);
  }

  async settle(userId: string, id: string, input: SettleBusinessEntryDto) {
    const entry = await this.findOwned(userId, id);
    if (entry.status !== BusinessEntryStatus.PENDING) {
      throw new BadRequestException('Esta conta já foi liquidada ou cancelada');
    }
    const accountId = input.accountId ?? entry.accountId ?? undefined;
    await this.validateReferences(userId, entry.categoryId, accountId);
    const settledAt = input.settledAt ? new Date(input.settledAt) : new Date();
    const transaction = await this.transactions.create(userId, {
      description: entry.title,
      amount: Number(entry.amount),
      type: entry.type === BusinessEntryType.RECEIVABLE ? TransactionType.INCOME : TransactionType.EXPENSE,
      source: TransactionSource.MANUAL,
      scope: FinancialScope.BUSINESS,
      categoryId: entry.categoryId,
      ...(accountId ? { accountId } : {}),
      date: settledAt.toISOString(),
    });
    const updated = await this.prisma.businessEntry.update({
      where: { id },
      data: { status: BusinessEntryStatus.SETTLED, settledAt, accountId: accountId ?? null, transactionId: transaction.id },
      include: this.entryInclude(),
    });
    return this.withEffectiveStatus(updated);
  }

  async cancel(userId: string, id: string) {
    const entry = await this.findOwned(userId, id);
    if (entry.status === BusinessEntryStatus.SETTLED) {
      throw new BadRequestException('Uma conta já liquidada não pode ser cancelada');
    }
    return this.prisma.businessEntry.update({ where: { id }, data: { status: BusinessEntryStatus.CANCELLED } });
  }

  async summary(userId: string) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [accounts, monthGroups, pending, alerts] = await Promise.all([
      this.prisma.financialAccount.aggregate({
        where: { userId, scope: FinancialScope.BUSINESS, isActive: true },
        _sum: { balance: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, scope: FinancialScope.BUSINESS, date: { gte: monthStart, lt: monthEnd } },
        _sum: { netAmount: true },
      }),
      this.prisma.businessEntry.findMany({
        where: { userId, status: BusinessEntryStatus.PENDING },
        select: { id: true, type: true, amount: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.businessEntry.findMany({
        where: {
          userId,
          status: BusinessEntryStatus.PENDING,
          dueDate: { lt: this.addDays(today, 4) },
        },
        include: this.entryInclude(),
        orderBy: { dueDate: 'asc' },
        take: 8,
      }),
    ]);
    const availableBalance = Number(accounts._sum.balance ?? 0);
    const monthIncome = Number(monthGroups.find((group) => group.type === TransactionType.INCOME)?._sum.netAmount ?? 0);
    const monthExpense = Number(monthGroups.find((group) => group.type === TransactionType.EXPENSE)?._sum.netAmount ?? 0);
    const receivable = this.sum(pending.filter((entry) => entry.type === BusinessEntryType.RECEIVABLE));
    const payable = this.sum(pending.filter((entry) => entry.type === BusinessEntryType.PAYABLE));
    const overdueReceivable = this.sum(pending.filter((entry) => entry.type === BusinessEntryType.RECEIVABLE && entry.dueDate < today));
    const overduePayable = this.sum(pending.filter((entry) => entry.type === BusinessEntryType.PAYABLE && entry.dueDate < today));
    const projections = [7, 30, 90].map((days) => {
      const until = this.addDays(today, days + 1);
      const selected = pending.filter((entry) => entry.dueDate >= today && entry.dueDate < until);
      const income = this.sum(selected.filter((entry) => entry.type === BusinessEntryType.RECEIVABLE));
      const expense = this.sum(selected.filter((entry) => entry.type === BusinessEntryType.PAYABLE));
      return { days, income, expense, balance: availableBalance + income - expense };
    });
    const monthPending = pending.filter((entry) => entry.dueDate >= monthStart && entry.dueDate < monthEnd);
    const estimatedResult = monthIncome - monthExpense
      + this.sum(monthPending.filter((entry) => entry.type === BusinessEntryType.RECEIVABLE))
      - this.sum(monthPending.filter((entry) => entry.type === BusinessEntryType.PAYABLE));
    return {
      availableBalance,
      monthIncome,
      monthExpense,
      receivable,
      payable,
      overdueReceivable,
      overduePayable,
      estimatedResult,
      projections,
      alerts: alerts.map((entry) => this.withEffectiveStatus(entry)),
    };
  }

  private async findOwned(userId: string, id: string) {
    const entry = await this.prisma.businessEntry.findFirst({ where: { id, userId } });
    if (!entry) throw new NotFoundException('Conta empresarial não encontrada');
    return entry;
  }

  private async validateReferences(userId: string, categoryId: string, accountId?: string) {
    const [category, account] = await Promise.all([
      this.prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } }),
      accountId
        ? this.prisma.financialAccount.findFirst({ where: { id: accountId, userId, scope: FinancialScope.BUSINESS }, select: { id: true } })
        : Promise.resolve({ id: '' }),
    ]);
    if (!category) throw new NotFoundException('Categoria não encontrada');
    if (accountId && !account) throw new NotFoundException('Conta empresarial não encontrada');
  }

  private recurrenceDates(first: Date, frequency?: RecurrenceFrequency, endDate?: string): Date[] {
    if (!frequency) return [first];
    const limit = endDate ? new Date(endDate) : this.addDays(first, 365);
    if (limit < first) throw new BadRequestException('O fim da recorrência deve ser posterior ao primeiro vencimento');
    const dates: Date[] = [];
    let current = first;
    while (current <= limit && dates.length < 53) {
      dates.push(current);
      current = this.nextDate(current, frequency);
    }
    return dates;
  }

  private nextDate(date: Date, frequency: RecurrenceFrequency): Date {
    const next = new Date(date);
    if (frequency === RecurrenceFrequency.WEEKLY) next.setUTCDate(next.getUTCDate() + 7);
    if (frequency === RecurrenceFrequency.MONTHLY) {
      const day = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(Math.min(day, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()));
    }
    if (frequency === RecurrenceFrequency.YEARLY) {
      const month = next.getUTCMonth();
      const day = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      next.setUTCMonth(month);
      next.setUTCDate(Math.min(day, new Date(Date.UTC(next.getUTCFullYear(), month + 1, 0)).getUTCDate()));
    }
    return next;
  }

  private entryInclude() {
    return {
      category: { select: { id: true, name: true, color: true } },
      account: { select: { id: true, name: true } },
    } as const;
  }

  private withEffectiveStatus<T extends { status: BusinessEntryStatus; dueDate: Date }>(entry: T) {
    return {
      ...entry,
      effectiveStatus: entry.status === BusinessEntryStatus.PENDING && entry.dueDate < new Date()
        ? 'OVERDUE'
        : entry.status,
    };
  }

  private sum(entries: Array<{ amount: unknown }>): number {
    return entries.reduce((total, entry) => total + Number(entry.amount), 0);
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
  }
}
