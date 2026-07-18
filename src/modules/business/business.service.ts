import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessEntryStatus,
  BusinessEntryType,
  BusinessCostType,
  FinancialScope,
  RecurrenceFrequency,
  TransactionSource,
  TransactionType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/config/database';
import { TransactionService } from '@/modules/transactions/transaction.service';
import { CreateBusinessEntryDto } from './dto/create-business-entry.dto';
import { CreateBusinessContactDto } from './dto/create-business-contact.dto';
import { SettleBusinessEntryDto } from './dto/settle-business-entry.dto';
import { UpdateBusinessContactDto } from './dto/update-business-contact.dto';
import { UpdateBusinessEntryDto } from './dto/update-business-entry.dto';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

@Injectable()
export class BusinessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
  ) {}

  async create(userId: string, input: CreateBusinessEntryDto) {
    const references = await this.validateReferences(userId, input.categoryId, input.accountId, input.contactId);
    const firstDueDate = new Date(input.dueDate);
    const seriesId = input.recurrenceFrequency ? randomUUID() : null;
    const dueDates = this.recurrenceDates(firstDueDate, input.recurrenceFrequency, input.recurrenceEndDate);
    const entries = await this.prisma.$transaction(
      dueDates.map((dueDate) => this.prisma.businessEntry.create({
        data: {
          userId,
          contactId: input.contactId ?? null,
          type: input.type,
          title: input.title.trim(),
          counterparty: references.contact?.name ?? input.counterparty.trim(),
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
    const references = await this.validateReferences(userId, input.categoryId ?? entry.categoryId, input.accountId, input.contactId);
    const updated = await this.prisma.businessEntry.update({
      where: { id },
      data: {
        ...input,
        ...(input.dueDate ? { dueDate: new Date(input.dueDate) } : {}),
        ...(input.title ? { title: input.title.trim() } : {}),
        ...(references.contact ? { counterparty: references.contact.name } : input.counterparty ? { counterparty: input.counterparty.trim() } : {}),
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
    const [accounts, income, expenseGroups, settings, pending, alerts] = await Promise.all([
      this.prisma.financialAccount.aggregate({
        where: { userId, scope: FinancialScope.BUSINESS, isActive: true },
        _sum: { balance: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, scope: FinancialScope.BUSINESS, type: TransactionType.INCOME, date: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true, netAmount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, scope: FinancialScope.BUSINESS, type: TransactionType.EXPENSE, date: { gte: monthStart, lt: monthEnd } },
        _sum: { netAmount: true },
      }),
      this.prisma.businessSettings.findUnique({ where: { userId } }),
      this.prisma.businessEntry.findMany({
        where: { userId, status: BusinessEntryStatus.PENDING },
        select: { id: true, type: true, amount: true, dueDate: true, categoryId: true },
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
    const expenseCategoryIds = [...new Set([
      ...expenseGroups.map((group) => group.categoryId),
      ...pending.filter((entry) => entry.type === BusinessEntryType.PAYABLE).map((entry) => entry.categoryId),
    ])];
    const expenseCategories = await this.prisma.category.findMany({
      where: { userId, id: { in: expenseCategoryIds } },
      select: { id: true, name: true, businessCostType: true },
    });
    const categoryType = new Map(expenseCategories.map((category) => [category.id, category.businessCostType]));
    const availableBalance = Number(accounts._sum.balance ?? 0);
    const grossRevenue = Number(income._sum.amount ?? 0);
    const netRevenue = Number(income._sum.netAmount ?? 0);
    const channelFees = Math.max(0, grossRevenue - netRevenue);
    const expenseTotalFor = (costType: BusinessCostType | null) => expenseGroups
      .filter((group) => (categoryType.get(group.categoryId) ?? null) === costType)
      .reduce((total, group) => total + Number(group._sum.netAmount ?? 0), 0);
    const variableCosts = expenseTotalFor(BusinessCostType.VARIABLE);
    const fixedExpenses = expenseTotalFor(BusinessCostType.FIXED);
    const unclassifiedExpenses = expenseTotalFor(null);
    const monthExpense = variableCosts + fixedExpenses + unclassifiedExpenses;
    const taxRate = Number(settings?.taxRate ?? 0);
    const taxProvision = grossRevenue * taxRate / 100;
    const resultOfMonth = netRevenue - variableCosts - fixedExpenses - unclassifiedExpenses - taxProvision;
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
    const pendingReceivable = this.sum(monthPending.filter((entry) => entry.type === BusinessEntryType.RECEIVABLE));
    const pendingPayable = this.sum(monthPending.filter((entry) => entry.type === BusinessEntryType.PAYABLE));
    const pendingTaxProvision = pendingReceivable * taxRate / 100;
    const estimatedNetResult = resultOfMonth + pendingReceivable - pendingPayable - pendingTaxProvision;
    const unclassifiedPending = this.sum(monthPending.filter((entry) =>
      entry.type === BusinessEntryType.PAYABLE && !categoryType.get(entry.categoryId)));
    const configurationComplete = Boolean(settings?.taxConfigured) && unclassifiedExpenses === 0 && unclassifiedPending === 0;
    return {
      availableBalance,
      monthIncome: netRevenue,
      monthExpense,
      receivable,
      payable,
      overdueReceivable,
      overduePayable,
      estimatedResult: estimatedNetResult,
      resultLabel: configurationComplete ? 'Lucro líquido estimado' : 'Resultado do mês',
      configurationComplete,
      configuration: {
        taxRate,
        taxConfigured: Boolean(settings?.taxConfigured),
        unclassifiedAmount: unclassifiedExpenses + unclassifiedPending,
      },
      statement: {
        grossRevenue,
        channelFees,
        netRevenue,
        variableCosts,
        fixedExpenses,
        unclassifiedExpenses,
        taxProvision,
        resultOfMonth,
        pendingReceivable,
        pendingPayable,
        pendingTaxProvision,
        estimatedNetResult,
      },
      expenseCategories: expenseCategories.map((category) => ({
        id: category.id,
        name: category.name,
        businessCostType: category.businessCostType,
        total: Number(expenseGroups.find((group) => group.categoryId === category.id)?._sum.netAmount ?? 0),
      })),
      projections,
      alerts: alerts.map((entry) => this.withEffectiveStatus(entry)),
    };
  }

  async settings(userId: string) {
    const settings = await this.prisma.businessSettings.findUnique({ where: { userId } });
    return { taxRate: Number(settings?.taxRate ?? 0), taxConfigured: Boolean(settings?.taxConfigured) };
  }

  async updateSettings(userId: string, input: UpdateBusinessSettingsDto) {
    const settings = await this.prisma.businessSettings.upsert({
      where: { userId },
      create: { userId, taxRate: input.taxRate, taxConfigured: true },
      update: { taxRate: input.taxRate, taxConfigured: true },
    });
    return { taxRate: Number(settings.taxRate), taxConfigured: settings.taxConfigured };
  }

  async listContacts(userId: string) {
    const contacts = await this.prisma.businessContact.findMany({
      where: { userId },
      include: {
        businessEntries: {
          where: { status: { not: BusinessEntryStatus.CANCELLED } },
          select: { type: true, status: true, amount: true, dueDate: true, settledAt: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    return contacts.map((contact) => this.contactSummary(contact));
  }

  async createContact(userId: string, input: CreateBusinessContactDto) {
    this.validateContactDetails(input.phone, input.email);
    const contact = await this.prisma.businessContact.create({
      data: {
        userId,
        type: input.type,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        notes: input.notes?.trim() || null,
      },
    });
    return { ...contact, totalSold: 0, totalPurchased: 0, pendingAmount: 0, lastMovementAt: null };
  }

  async updateContact(userId: string, id: string, input: UpdateBusinessContactDto) {
    const current = await this.findOwnedContact(userId, id);
    const phone = input.phone === undefined ? current.phone : input.phone.trim() || null;
    const email = input.email === undefined ? current.email : input.email.trim().toLowerCase() || null;
    this.validateContactDetails(phone, email);
    return this.prisma.businessContact.update({
      where: { id },
      data: {
        ...(input.type ? { type: input.type } : {}),
        ...(input.name ? { name: input.name.trim() } : {}),
        phone,
        email,
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      },
    });
  }

  async deleteContact(userId: string, id: string): Promise<void> {
    await this.findOwnedContact(userId, id);
    await this.prisma.businessContact.delete({ where: { id } });
  }

  private async findOwned(userId: string, id: string) {
    const entry = await this.prisma.businessEntry.findFirst({ where: { id, userId } });
    if (!entry) throw new NotFoundException('Conta empresarial não encontrada');
    return entry;
  }

  private async validateReferences(userId: string, categoryId: string, accountId?: string, contactId?: string) {
    const [category, account, contact] = await Promise.all([
      this.prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } }),
      accountId
        ? this.prisma.financialAccount.findFirst({ where: { id: accountId, userId, scope: FinancialScope.BUSINESS }, select: { id: true } })
        : Promise.resolve({ id: '' }),
      contactId
        ? this.prisma.businessContact.findFirst({ where: { id: contactId, userId }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);
    if (!category) throw new NotFoundException('Categoria não encontrada');
    if (accountId && !account) throw new NotFoundException('Conta empresarial não encontrada');
    if (contactId && !contact) throw new NotFoundException('Cliente ou fornecedor não encontrado');
    return { contact };
  }

  private async findOwnedContact(userId: string, id: string) {
    const contact = await this.prisma.businessContact.findFirst({ where: { id, userId } });
    if (!contact) throw new NotFoundException('Cliente ou fornecedor não encontrado');
    return contact;
  }

  private validateContactDetails(phone?: string | null, email?: string | null) {
    if (!phone && !email) throw new BadRequestException('Informe um telefone ou e-mail');
  }

  private contactSummary<T extends { businessEntries: Array<{ type: BusinessEntryType; status: BusinessEntryStatus; amount: unknown; dueDate: Date; settledAt: Date | null; updatedAt: Date }> }>(contact: T) {
    const { businessEntries, ...details } = contact;
    const totalSold = this.sum(businessEntries.filter((entry) => entry.type === BusinessEntryType.RECEIVABLE));
    const totalPurchased = this.sum(businessEntries.filter((entry) => entry.type === BusinessEntryType.PAYABLE));
    const pendingAmount = this.sum(businessEntries.filter((entry) => entry.status === BusinessEntryStatus.PENDING));
    const last = businessEntries[0];
    return {
      ...details,
      totalSold,
      totalPurchased,
      pendingAmount,
      lastMovementAt: last ? (last.settledAt ?? last.updatedAt ?? last.dueDate) : null,
    };
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
      contact: { select: { id: true, name: true, type: true } },
    } as const;
  }

  private withEffectiveStatus<T extends { status: BusinessEntryStatus; dueDate: Date }>(entry: T) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return {
      ...entry,
      effectiveStatus: entry.status === BusinessEntryStatus.PENDING && entry.dueDate < today
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
