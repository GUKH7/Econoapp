import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  FinancialScope,
  RecurrenceFrequency,
  RecurringTransaction,
  Transaction,
  TransactionSource,
  TransactionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/config/database';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { UpdateRecurringTransactionDto } from './dto/update-recurring-transaction.dto';
import { TransactionService } from './transaction.service';

@Injectable()
export class RecurringTransactionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async create(userId: string, input: CreateRecurringTransactionDto): Promise<RecurringTransaction> {
    this.validatePaymentTarget(input.type, input.creditCardId);
    await this.validateReferences(userId, input);
    const startDate = startOfDay(input.startDate);
    const endDate = input.endDate ? startOfDay(input.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('A data final deve ser maior ou igual a data inicial');
    }

    const rule = await this.prisma.recurringTransaction.create({
      data: {
        userId,
        description: input.description,
        amount: input.amount,
        type: input.type,
        scope: input.scope ?? FinancialScope.PERSONAL,
        categoryId: input.categoryId,
        channelId: input.channelId ?? null,
        accountId: input.accountId ?? null,
        creditCardId: input.creditCardId ?? null,
        frequency: input.frequency ?? RecurrenceFrequency.MONTHLY,
        interval: input.interval ?? 1,
        startDate,
        nextRunAt: startDate,
        endDate,
        maxOccurrences: input.maxOccurrences ?? null,
      },
    });

    if (input.generateFirst) {
      await this.generateDue(userId, new Date());
      return this.findOneByUser(userId, rule.id) as Promise<RecurringTransaction>;
    }

    return rule;
  }

  async list(userId: string, scope?: FinancialScope): Promise<RecurringTransaction[]> {
    return this.prisma.recurringTransaction.findMany({
      where: { userId, ...(scope ? { scope } : {}) },
      orderBy: [{ isActive: 'desc' }, { nextRunAt: 'asc' }],
    });
  }

  async findOneByUser(userId: string, id: string): Promise<RecurringTransaction | null> {
    return this.prisma.recurringTransaction.findFirst({ where: { id, userId } });
  }

  async deactivate(userId: string, id: string): Promise<RecurringTransaction> {
    const current = await this.findOneByUser(userId, id);
    if (!current) throw new BadRequestException('Recorrencia nao encontrada');
    return this.prisma.recurringTransaction.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async update(
    userId: string,
    id: string,
    input: UpdateRecurringTransactionDto,
  ): Promise<RecurringTransaction> {
    const current = await this.findOneByUser(userId, id);
    if (!current) throw new BadRequestException('Recorrência não encontrada');

    const merged = {
      description: input.description ?? current.description,
      amount: input.amount ?? Number(current.amount),
      type: input.type ?? current.type,
      scope: input.scope ?? current.scope,
      categoryId: input.categoryId ?? current.categoryId,
      channelId: input.channelId !== undefined ? input.channelId : current.channelId ?? undefined,
      accountId: input.accountId !== undefined ? input.accountId : current.accountId ?? undefined,
      creditCardId:
        input.creditCardId !== undefined ? input.creditCardId : current.creditCardId ?? undefined,
      frequency: input.frequency ?? current.frequency,
      interval: input.interval ?? current.interval,
      startDate: input.startDate ?? current.startDate.toISOString(),
      endDate:
        input.endDate !== undefined ? input.endDate : current.endDate?.toISOString(),
      maxOccurrences:
        input.maxOccurrences !== undefined ? input.maxOccurrences : current.maxOccurrences ?? undefined,
    };
    this.validatePaymentTarget(merged.type, merged.creditCardId);
    await this.validateReferences(userId, merged);

    const scheduleChanged =
      input.startDate !== undefined || input.frequency !== undefined || input.interval !== undefined;
    const startDate = startOfDay(merged.startDate);
    const endDate = merged.endDate ? startOfDay(merged.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('A data final deve ser maior ou igual à data inicial');
    }

    return this.prisma.recurringTransaction.update({
      where: { id },
      data: {
        ...input,
        ...(input.startDate !== undefined ? { startDate } : {}),
        ...(input.endDate !== undefined ? { endDate } : {}),
        ...(scheduleChanged ? { nextRunAt: startDate } : {}),
      },
    });
  }

  async generateDue(
    userId: string,
    until = new Date(),
  ): Promise<{ created: number; rulesChecked: number; transactions: Transaction[] }> {
    const untilDate = endOfDay(until);
    const rules = await this.prisma.recurringTransaction.findMany({
      where: {
        userId,
        isActive: true,
        nextRunAt: { lte: untilDate },
      },
      orderBy: { nextRunAt: 'asc' },
    });

    const transactions: Transaction[] = [];
    for (const rule of rules) {
      const created = await this.generateForRule(userId, rule, untilDate);
      transactions.push(...created);
    }

    return { created: transactions.length, rulesChecked: rules.length, transactions };
  }

  async generateAllDue(until = new Date()): Promise<{ created: number; usersChecked: number }> {
    const dueUsers = await this.prisma.recurringTransaction.findMany({
      where: { isActive: true, nextRunAt: { lte: endOfDay(until) } },
      select: { userId: true },
      distinct: ['userId'],
    });
    let created = 0;
    for (const { userId } of dueUsers) {
      const result = await this.generateDue(userId, until);
      created += result.created;
    }
    return { created, usersChecked: dueUsers.length };
  }

  private async generateForRule(
    userId: string,
    rule: RecurringTransaction,
    untilDate: Date,
  ): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    let nextRunAt = new Date(rule.nextRunAt);
    let generatedCount = rule.generatedCount;
    let isActive = rule.isActive;

    while (isActive && nextRunAt <= untilDate) {
      if (rule.endDate && nextRunAt > rule.endDate) {
        isActive = false;
        break;
      }
      if (rule.maxOccurrences && generatedCount >= rule.maxOccurrences) {
        isActive = false;
        break;
      }

      const existing = await this.prisma.transaction.findFirst({
        where: { userId, recurringRuleId: rule.id, date: nextRunAt },
      });
      if (!existing) {
        const paymentTarget = {
          ...(rule.channelId ? { channelId: rule.channelId } : {}),
          ...(rule.accountId ? { accountId: rule.accountId } : {}),
          ...(rule.creditCardId ? { creditCardId: rule.creditCardId } : {}),
        };
        try {
          const transaction = await this.transactionService.create(userId, {
            description: occurrenceDescription(rule, generatedCount + 1),
            amount: Number(rule.amount),
            type: rule.type,
            source: TransactionSource.RECURRENT,
            scope: rule.scope,
            categoryId: rule.categoryId,
            ...paymentTarget,
            date: nextRunAt.toISOString(),
            recurringRuleId: rule.id,
          });
          transactions.push(transaction);
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
            throw error;
          }
        }
      }

      generatedCount += 1;
      nextRunAt = addInterval(nextRunAt, rule.frequency, rule.interval);
      if (rule.maxOccurrences && generatedCount >= rule.maxOccurrences) {
        isActive = false;
      }
      if (rule.endDate && nextRunAt > rule.endDate) {
        isActive = false;
      }
    }

    await this.prisma.recurringTransaction.update({
      where: { id: rule.id },
      data: {
        nextRunAt,
        generatedCount,
        isActive,
      },
    });

    return transactions;
  }

  private validatePaymentTarget(type: TransactionType, creditCardId?: string): void {
    if (type === TransactionType.INCOME && creditCardId) {
      throw new BadRequestException('Receitas recorrentes devem cair em uma conta ou carteira');
    }
  }

  private async validateReferences(
    userId: string,
    input: {
      categoryId: string;
      channelId?: string | null | undefined;
      accountId?: string | null | undefined;
      creditCardId?: string | null | undefined;
    },
  ): Promise<void> {
    const [category, channel, account, creditCard] = await Promise.all([
      this.prisma.category.findFirst({ where: { id: input.categoryId, userId }, select: { id: true } }),
      input.channelId
        ? this.prisma.salesChannel.findFirst({ where: { id: input.channelId, userId }, select: { id: true } })
        : null,
      input.accountId
        ? this.prisma.financialAccount.findFirst({ where: { id: input.accountId, userId }, select: { id: true } })
        : null,
      input.creditCardId
        ? this.prisma.creditCard.findFirst({ where: { id: input.creditCardId, userId }, select: { id: true } })
        : null,
    ]);

    if (!category) throw new BadRequestException('Categoria nao encontrada');
    if (input.channelId && !channel) throw new BadRequestException('Canal de venda nao encontrado');
    if (input.accountId && !account) throw new BadRequestException('Conta nao encontrada');
    if (input.creditCardId && !creditCard) throw new BadRequestException('Cartao de credito nao encontrado');
  }
}

function occurrenceDescription(rule: RecurringTransaction, occurrence: number): string {
  if (!rule.maxOccurrences) return rule.description;
  return `${rule.description} (${occurrence}/${rule.maxOccurrences})`;
}

function addInterval(date: Date, frequency: RecurrenceFrequency, interval: number): Date {
  const next = new Date(date);
  if (frequency === RecurrenceFrequency.WEEKLY) {
    next.setUTCDate(next.getUTCDate() + 7 * interval);
    return next;
  }
  if (frequency === RecurrenceFrequency.YEARLY) {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCFullYear(next.getUTCFullYear() + interval);
    next.setUTCDate(Math.min(day, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
    return next;
  }
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + interval);
  next.setUTCDate(Math.min(day, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
  return next;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function startOfDay(value: string): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}
