import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessEntryStatus,
  BusinessEntryType,
  BusinessSettings,
  BusinessCostType,
  FinancialScope,
  RecurrenceFrequency,
  TransactionSource,
  TransactionType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { PrismaService } from '@/config/database';
import { TransactionService } from '@/modules/transactions/transaction.service';
import { CreateBusinessEntryDto } from './dto/create-business-entry.dto';
import { CreateBusinessContactDto } from './dto/create-business-contact.dto';
import { CreateBusinessOfferingDto } from './dto/create-business-offering.dto';
import { SettleBusinessEntryDto } from './dto/settle-business-entry.dto';
import { UpdateBusinessContactDto } from './dto/update-business-contact.dto';
import { UpdateBusinessEntryDto } from './dto/update-business-entry.dto';
import { UpdateBusinessOfferingDto } from './dto/update-business-offering.dto';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';
import { CompleteBusinessOnboardingDto } from './dto/complete-business-onboarding.dto';

const BUSINESS_CATEGORY_PRESETS: Record<string, Array<{ name: string; costType: BusinessCostType | null }>> = {
  COMMERCE: [{ name: 'Vendas', costType: null }, { name: 'Estoque e mercadorias', costType: BusinessCostType.VARIABLE }, { name: 'Embalagens', costType: BusinessCostType.VARIABLE }],
  SERVICES: [{ name: 'Serviços prestados', costType: null }, { name: 'Prestadores e comissões', costType: BusinessCostType.VARIABLE }, { name: 'Ferramentas e sistemas', costType: BusinessCostType.FIXED }],
  FOOD: [{ name: 'Vendas', costType: null }, { name: 'Insumos e ingredientes', costType: BusinessCostType.VARIABLE }, { name: 'Embalagens', costType: BusinessCostType.VARIABLE }],
  BEAUTY: [{ name: 'Serviços prestados', costType: null }, { name: 'Produtos e insumos', costType: BusinessCostType.VARIABLE }, { name: 'Aluguel do espaço', costType: BusinessCostType.FIXED }],
  FREELANCER: [{ name: 'Serviços prestados', costType: null }, { name: 'Ferramentas e assinaturas', costType: BusinessCostType.FIXED }, { name: 'Prestadores', costType: BusinessCostType.VARIABLE }],
  OTHER: [{ name: 'Receitas do negócio', costType: null }, { name: 'Operação', costType: BusinessCostType.VARIABLE }, { name: 'Administração', costType: BusinessCostType.FIXED }],
};

@Injectable()
export class BusinessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
  ) {}

  async create(userId: string, input: CreateBusinessEntryDto) {
    const references = await this.validateReferences(userId, input.categoryId, input.accountId, input.contactId, input.offeringId);
    if (input.offeringId && input.type !== BusinessEntryType.RECEIVABLE) throw new BadRequestException('Produto ou serviço só pode ser vinculado a uma conta a receber');
    const firstDueDate = new Date(input.dueDate);
    const seriesId = input.recurrenceFrequency ? randomUUID() : null;
    const dueDates = this.recurrenceDates(firstDueDate, input.recurrenceFrequency, input.recurrenceEndDate);
    const entries = await this.prisma.$transaction(
      dueDates.map((dueDate) => this.prisma.businessEntry.create({
        data: {
          userId,
          contactId: input.contactId ?? null,
          offeringId: input.offeringId ?? null,
          quantity: input.quantity ?? 1,
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
    const references = await this.validateReferences(userId, input.categoryId ?? entry.categoryId, input.accountId, input.contactId, input.offeringId);
    if ((input.offeringId ?? entry.offeringId) && (input.type ?? entry.type) !== BusinessEntryType.RECEIVABLE) throw new BadRequestException('Produto ou serviço só pode ser vinculado a uma conta a receber');
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
      ...(entry.offeringId ? { offeringId: entry.offeringId, quantity: Number(entry.quantity) } : {}),
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
    const revenueGoal = Number(settings?.revenueGoal ?? 0);
    const revenueGoalProgress = revenueGoal > 0 ? Math.min(100, Math.round(grossRevenue / revenueGoal * 100)) : 0;
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
        businessType: settings?.businessType ?? null,
        receivingMethods: settings?.receivingMethods ?? [],
        revenueGoal,
        revenueGoalProgress,
        revenueGoalGap: Math.max(0, revenueGoal - grossRevenue),
        onboardingCompleted: Boolean(settings?.onboardingCompleted),
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
    return this.settingsResponse(settings);
  }

  async updateSettings(userId: string, input: UpdateBusinessSettingsDto) {
    const settings = await this.prisma.businessSettings.upsert({
      where: { userId },
      create: { userId, taxRate: input.taxRate, taxConfigured: true },
      update: { taxRate: input.taxRate, taxConfigured: true },
    });
    return this.settingsResponse(settings);
  }

  async completeOnboarding(userId: string, input: CompleteBusinessOnboardingDto) {
    const salesChannels = this.cleanLabels(input.salesChannels);
    const recurringExpenses = this.cleanLabels(input.recurringExpenses);
    const receivingMethods = this.cleanLabels(input.receivingMethods);
    if (!salesChannels.length || !receivingMethods.length) throw new BadRequestException('Informe ao menos um canal de venda e uma forma de recebimento');

    const [categories, channels] = await Promise.all([
      this.prisma.category.findMany({ where: { userId }, select: { name: true } }),
      this.prisma.salesChannel.findMany({ where: { userId }, select: { name: true } }),
    ]);
    const existingCategories = new Set(categories.map((item) => item.name.trim().toLocaleLowerCase('pt-BR')));
    const existingChannels = new Set(channels.map((item) => item.name.trim().toLocaleLowerCase('pt-BR')));
    const presetCategories = [
      ...(BUSINESS_CATEGORY_PRESETS[input.businessType] ?? BUSINESS_CATEGORY_PRESETS.OTHER!),
      ...recurringExpenses.map((name) => ({ name, costType: BusinessCostType.FIXED })),
    ].filter((item, index, all) => all.findIndex((candidate) => candidate.name.toLocaleLowerCase('pt-BR') === item.name.toLocaleLowerCase('pt-BR')) === index);
    const taxRate = input.reserveTaxes ? input.taxRate : 0;
    const operations = [
      this.prisma.businessSettings.upsert({
        where: { userId },
        create: {
          userId,
          businessType: input.businessType,
          salesChannels,
          recurringExpenses,
          receivingMethods,
          revenueGoal: input.revenueGoal,
          taxRate,
          taxConfigured: true,
          onboardingCompleted: true,
        },
        update: {
          businessType: input.businessType,
          salesChannels,
          recurringExpenses,
          receivingMethods,
          revenueGoal: input.revenueGoal,
          taxRate,
          taxConfigured: true,
          onboardingCompleted: true,
        },
      }),
      ...presetCategories
        .filter((item) => !existingCategories.has(item.name.toLocaleLowerCase('pt-BR')))
        .map((item) => this.prisma.category.create({ data: { userId, name: item.name, color: item.costType === BusinessCostType.FIXED ? '#8B5CF6' : item.costType === BusinessCostType.VARIABLE ? '#F59E0B' : '#00BFA6', businessCostType: item.costType } })),
      ...salesChannels
        .filter((name) => !existingChannels.has(name.toLocaleLowerCase('pt-BR')))
        .map((name) => this.prisma.salesChannel.create({ data: { userId, name, feePercent: 0, isActive: true } })),
    ];
    const [settings] = await this.prisma.$transaction(operations);
    return this.settingsResponse(settings as BusinessSettings);
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
    await this.prisma.businessEntry.updateMany({
      where: { userId, contactId: null, counterparty: { equals: contact.name, mode: 'insensitive' } },
      data: { contactId: contact.id },
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

  async listOfferings(userId: string) {
    return this.prisma.businessOffering.findMany({ where: { userId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  async createOffering(userId: string, input: CreateBusinessOfferingDto) {
    return this.prisma.businessOffering.create({
      data: { userId, type: input.type, name: input.name.trim(), estimatedUnitCost: input.estimatedUnitCost, defaultPrice: input.defaultPrice ?? null },
    });
  }

  async updateOffering(userId: string, id: string, input: UpdateBusinessOfferingDto) {
    await this.findOwnedOffering(userId, id);
    return this.prisma.businessOffering.update({ where: { id }, data: { ...input, ...(input.name ? { name: input.name.trim() } : {}) } });
  }

  async deleteOffering(userId: string, id: string): Promise<void> {
    await this.findOwnedOffering(userId, id);
    await this.prisma.businessOffering.update({ where: { id }, data: { isActive: false } });
  }

  async productReport(userId: string, startDate?: string, endDate?: string) {
    const now = new Date();
    const start = startDate ? new Date(`${startDate}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = endDate ? this.addDays(new Date(`${endDate}T00:00:00.000Z`), 1) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new BadRequestException('Período do relatório inválido');
    const offerings = await this.prisma.businessOffering.findMany({
      where: { userId },
      include: { transactions: { where: { userId, type: TransactionType.INCOME, scope: FinancialScope.BUSINESS, date: { gte: start, lt: end } }, select: { amount: true, netAmount: true, quantity: true, unitCost: true } } },
      orderBy: { name: 'asc' },
    });
    const items = offerings.map((offering) => {
      const quantity = offering.transactions.reduce((sum, transaction) => sum + Number(transaction.quantity), 0);
      const grossRevenue = offering.transactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
      const netRevenue = offering.transactions.reduce((sum, transaction) => sum + Number(transaction.netAmount), 0);
      const estimatedCost = offering.transactions.reduce((sum, transaction) => sum + Number(transaction.unitCost ?? offering.estimatedUnitCost) * Number(transaction.quantity), 0);
      const margin = netRevenue - estimatedCost;
      return { id: offering.id, name: offering.name, type: offering.type, quantity, grossRevenue, netRevenue, estimatedCost, margin, marginPercent: netRevenue > 0 ? margin / netRevenue * 100 : 0 };
    }).filter((item) => item.quantity > 0);
    const mostProfitable = [...items].sort((a, b) => b.margin - a.margin)[0] ?? null;
    const averageQuantity = items.length ? items.reduce((sum, item) => sum + item.quantity, 0) / items.length : 0;
    const highVolumeLowMargin = items.length > 1 ? [...items].filter((item) => item.quantity >= averageQuantity && item.marginPercent < 30).sort((a, b) => a.marginPercent - b.marginPercent)[0] ?? null : null;
    return {
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
      totals: {
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
        netRevenue: items.reduce((sum, item) => sum + item.netRevenue, 0),
        estimatedCost: items.reduce((sum, item) => sum + item.estimatedCost, 0),
        margin: items.reduce((sum, item) => sum + item.margin, 0),
      },
      mostProfitable,
      highVolumeLowMargin,
      items: [...items].sort((a, b) => b.margin - a.margin),
    };
  }

  async accountingReport(userId: string, startDate?: string, endDate?: string) {
    const now = new Date();
    const start = startDate ? new Date(`${startDate}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = endDate ? this.addDays(new Date(`${endDate}T00:00:00.000Z`), 1) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new BadRequestException('Período do relatório inválido');
    const previousStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
    const previousEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const [transactions, previousTransactions, pending, settings, clientEntries, productReport, accounts] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId, scope: FinancialScope.BUSINESS, date: { gte: start, lt: end } },
        include: { category: { select: { name: true, businessCostType: true } }, channel: { select: { id: true, name: true } }, offering: { select: { id: true, name: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.transaction.findMany({ where: { userId, scope: FinancialScope.BUSINESS, date: { gte: previousStart, lt: previousEnd } }, select: { type: true, amount: true, netAmount: true } }),
      this.prisma.businessEntry.findMany({ where: { userId, status: BusinessEntryStatus.PENDING, dueDate: { gte: now, lt: end } }, select: { type: true, amount: true, dueDate: true, counterparty: true } }),
      this.prisma.businessSettings.findUnique({ where: { userId } }),
      this.prisma.businessEntry.findMany({ where: { userId, type: BusinessEntryType.RECEIVABLE, status: BusinessEntryStatus.SETTLED, settledAt: { gte: start, lt: end } }, select: { amount: true, counterparty: true, contact: { select: { id: true, name: true } } } }),
      this.productReport(userId, this.dateKey(start), this.dateKey(this.addDays(end, -1))),
      this.prisma.financialAccount.aggregate({ where: { userId, scope: FinancialScope.BUSINESS, isActive: true }, _sum: { balance: true } }),
    ]);
    const incomes = transactions.filter((item) => item.type === TransactionType.INCOME);
    const expenses = transactions.filter((item) => item.type === TransactionType.EXPENSE);
    const grossRevenue = this.sumField(incomes, 'amount');
    const netRevenue = this.sumField(incomes, 'netAmount');
    const channelFees = grossRevenue - netRevenue;
    const expenseByType = (type: BusinessCostType | null) => expenses.filter((item) => (item.category.businessCostType ?? null) === type).reduce((sum, item) => sum + Number(item.netAmount), 0);
    const variableExpenses = expenseByType(BusinessCostType.VARIABLE);
    const fixedExpenses = expenseByType(BusinessCostType.FIXED);
    const unclassifiedExpenses = expenseByType(null);
    const taxRate = Number(settings?.taxRate ?? 0);
    const taxProvision = grossRevenue * taxRate / 100;
    const result = netRevenue - variableExpenses - fixedExpenses - unclassifiedExpenses - taxProvision;
    const previousIncome = previousTransactions.filter((item) => item.type === TransactionType.INCOME).reduce((sum, item) => sum + Number(item.netAmount), 0);
    const previousExpense = previousTransactions.filter((item) => item.type === TransactionType.EXPENSE).reduce((sum, item) => sum + Number(item.netAmount), 0);
    const currentExpense = variableExpenses + fixedExpenses + unclassifiedExpenses;
    const pendingReceivable = this.sum(pending.filter((item) => item.type === BusinessEntryType.RECEIVABLE));
    const pendingPayable = this.sum(pending.filter((item) => item.type === BusinessEntryType.PAYABLE));
    const forecastTax = pendingReceivable * taxRate / 100;
    const cashFlowMap = new Map<string, { date: string; income: number; expense: number }>();
    transactions.forEach((item) => {
      const key = this.dateKey(item.date);
      const row = cashFlowMap.get(key) ?? { date: key, income: 0, expense: 0 };
      if (item.type === TransactionType.INCOME) row.income += Number(item.netAmount);
      else row.expense += Number(item.netAmount);
      cashFlowMap.set(key, row);
    });
    const aggregateNamed = <T>(items: T[], nameOf: (item: T) => string, valueOf: (item: T) => number) => {
      const map = new Map<string, number>();
      items.forEach((item) => { const name = nameOf(item); map.set(name, (map.get(name) ?? 0) + valueOf(item)); });
      return [...map.entries()].map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue);
    };
    const revenueByClient = aggregateNamed(clientEntries, (item) => item.contact?.name ?? item.counterparty, (item) => Number(item.amount));
    const revenueByChannel = aggregateNamed(incomes, (item) => item.channel?.name ?? 'Sem canal', (item) => Number(item.netAmount));
    const timing = this.salesTiming(incomes.map((item) => ({ date: item.date, revenue: Number(item.netAmount) })));
    const revenueGoal = Number(settings?.revenueGoal ?? 0);
    return {
      period: { startDate: this.dateKey(start), endDate: this.dateKey(this.addDays(end, -1)) },
      profile: {
        businessType: settings?.businessType ?? null,
        revenueGoal,
        revenueGoalProgress: revenueGoal > 0 ? Math.min(100, Math.round(grossRevenue / revenueGoal * 100)) : 0,
        revenueGoalGap: Math.max(0, revenueGoal - grossRevenue),
      },
      cashFlow: { availableBalance: Number(accounts._sum.balance ?? 0), rows: [...cashFlowMap.values()].map((row) => ({ ...row, net: row.income - row.expense })) },
      incomeStatement: { grossRevenue, channelFees, netRevenue, variableExpenses, fixedExpenses, unclassifiedExpenses, taxRate, taxProvision, result },
      revenueByClient,
      revenueByProduct: productReport.items,
      revenueByChannel,
      expenseComposition: { fixed: fixedExpenses, variable: variableExpenses, unclassified: unclassifiedExpenses },
      monthlyComparison: { current: { income: netRevenue, expense: currentExpense, result }, previous: { income: previousIncome, expense: previousExpense, result: previousIncome - previousExpense }, incomeChange: this.changePercent(previousIncome, netRevenue), expenseChange: this.changePercent(previousExpense, currentExpense) },
      forecast: { realizedResult: result, pendingReceivable, pendingPayable, additionalTaxProvision: forecastTax, estimatedClosingResult: result + pendingReceivable - pendingPayable - forecastTax },
      salesTiming: timing,
    };
  }

  async accountingReportCsv(userId: string, startDate?: string, endDate?: string): Promise<string> {
    const report = await this.accountingReport(userId, startDate, endDate);
    const lines: string[][] = [['RELATORIO EMPRESARIAL DIN'], ['Periodo', `${report.period.startDate} a ${report.period.endDate}`], ['Meta de faturamento', String(report.profile.revenueGoal)], ['Progresso da meta (%)', String(report.profile.revenueGoalProgress)], [], ['DRE SIMPLIFICADO'], ['Item', 'Valor'],
      ['Faturamento bruto', String(report.incomeStatement.grossRevenue)], ['Taxas dos canais', String(report.incomeStatement.channelFees)], ['Faturamento liquido', String(report.incomeStatement.netRevenue)], ['Custos variaveis', String(report.incomeStatement.variableExpenses)], ['Despesas fixas', String(report.incomeStatement.fixedExpenses)], ['Provisao de impostos', String(report.incomeStatement.taxProvision)], ['Resultado', String(report.incomeStatement.result)],
      [], ['RECEITAS POR CLIENTE'], ['Cliente', 'Receita'], ...report.revenueByClient.map((item) => [item.name, String(item.revenue)]),
      [], ['RECEITAS POR PRODUTO/SERVICO'], ['Item', 'Quantidade', 'Receita liquida', 'Custo estimado', 'Margem'], ...report.revenueByProduct.map((item) => [item.name, String(item.quantity), String(item.netRevenue), String(item.estimatedCost), String(item.margin)]),
      [], ['RECEITAS POR CANAL'], ['Canal', 'Receita'], ...report.revenueByChannel.map((item) => [item.name, String(item.revenue)]),
      [], ['FLUXO DE CAIXA'], ['Data', 'Entradas', 'Saidas', 'Liquido'], ...report.cashFlow.rows.map((item) => [item.date, String(item.income), String(item.expense), String(item.net)]),
      [], ['PREVISAO DE FECHAMENTO'], ['Resultado realizado', String(report.forecast.realizedResult)], ['A receber', String(report.forecast.pendingReceivable)], ['A pagar', String(report.forecast.pendingPayable)], ['Resultado estimado', String(report.forecast.estimatedClosingResult)],
    ];
    return `\uFEFF${lines.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')}`;
  }

  async accountingReportPdf(userId: string, startDate?: string, endDate?: string): Promise<Buffer> {
    const report = await this.accountingReport(userId, startDate, endDate);
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: 'Relatório empresarial Din' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    const ensure = (height = 70) => { if (doc.y + height > doc.page.height - 55) doc.addPage(); };
    const heading = (title: string) => {
      ensure(55);
      doc.moveDown(.7).font('Helvetica-Bold').fontSize(14).fillColor('#009b83').text(title, 42, doc.y, { width: doc.page.width - 84 });
      doc.moveDown(.35);
    };
    const row = (label: string, value: string) => { ensure(24); const y = doc.y; doc.font('Helvetica').fontSize(9).fillColor('#475569').text(label, 42, y, { width: 360 }); doc.font('Helvetica-Bold').fillColor('#0f172a').text(value, 402, y, { width: 150, align: 'right' }); doc.moveDown(.75); };
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#07172a').text('Din - Relatório empresarial');
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(`Período: ${report.period.startDate} a ${report.period.endDate}`);
    if (report.profile.revenueGoal > 0) row('Meta de faturamento', `${money(report.profile.revenueGoal)} · ${report.profile.revenueGoalProgress}% alcançada`);
    heading('Demonstrativo simplificado de resultado');
    row('Faturamento bruto', money(report.incomeStatement.grossRevenue)); row('(-) Taxas dos canais', money(report.incomeStatement.channelFees)); row('Faturamento líquido', money(report.incomeStatement.netRevenue)); row('(-) Custos variáveis', money(report.incomeStatement.variableExpenses)); row('(-) Despesas fixas', money(report.incomeStatement.fixedExpenses)); row('(-) Provisão para impostos', money(report.incomeStatement.taxProvision)); row('Resultado do período', money(report.incomeStatement.result));
    heading('Previsão para o fechamento'); row('Resultado realizado', money(report.forecast.realizedResult)); row('(+) Valores a receber', money(report.forecast.pendingReceivable)); row('(-) Valores a pagar', money(report.forecast.pendingPayable)); row('Resultado estimado', money(report.forecast.estimatedClosingResult));
    const table = (title: string, items: Array<{ name: string; revenue: number }>) => { heading(title); if (!items.length) row('Sem dados no período', '-'); else items.slice(0, 20).forEach((item) => row(item.name, money(item.revenue))); };
    table('Receitas por cliente', report.revenueByClient); table('Receitas por canal', report.revenueByChannel);
    heading('Receitas e margem por produto/serviço'); report.revenueByProduct.slice(0, 20).forEach((item) => row(`${item.name} - ${Number(item.quantity).toLocaleString('pt-BR')} un.`, `${money(item.netRevenue)} | margem ${money(item.margin)}`));
    heading('Fluxo de caixa diário'); report.cashFlow.rows.slice(0, 31).forEach((item) => row(item.date, `+ ${money(item.income)} | - ${money(item.expense)} | ${money(item.net)}`));
    heading('Padrões de venda'); row('Dia com mais vendas', report.salesTiming.bestDay?.label ?? '-'); row('Horário com mais vendas', report.salesTiming.bestHour?.label ?? '-');
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(`Din - página ${i + 1} de ${range.count}`, 42, doc.page.height - 60, {
        width: doc.page.width - 84,
        align: 'center',
        lineBreak: false,
      });
    }
    doc.end();
    return done;
  }

  private async findOwned(userId: string, id: string) {
    const entry = await this.prisma.businessEntry.findFirst({ where: { id, userId } });
    if (!entry) throw new NotFoundException('Conta empresarial não encontrada');
    return entry;
  }

  private settingsResponse(settings: BusinessSettings | null) {
    return {
      taxRate: Number(settings?.taxRate ?? 0),
      taxConfigured: Boolean(settings?.taxConfigured),
      businessType: settings?.businessType ?? null,
      salesChannels: settings?.salesChannels ?? [],
      recurringExpenses: settings?.recurringExpenses ?? [],
      receivingMethods: settings?.receivingMethods ?? [],
      revenueGoal: Number(settings?.revenueGoal ?? 0),
      onboardingCompleted: Boolean(settings?.onboardingCompleted),
    };
  }

  private cleanLabels(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private async validateReferences(userId: string, categoryId: string, accountId?: string, contactId?: string, offeringId?: string) {
    const [category, account, contact, offering] = await Promise.all([
      this.prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } }),
      accountId
        ? this.prisma.financialAccount.findFirst({ where: { id: accountId, userId, scope: FinancialScope.BUSINESS }, select: { id: true } })
        : Promise.resolve({ id: '' }),
      contactId
        ? this.prisma.businessContact.findFirst({ where: { id: contactId, userId }, select: { id: true, name: true } })
        : Promise.resolve(null),
      offeringId
        ? this.prisma.businessOffering.findFirst({ where: { id: offeringId, userId, isActive: true }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);
    if (!category) throw new NotFoundException('Categoria não encontrada');
    if (accountId && !account) throw new NotFoundException('Conta empresarial não encontrada');
    if (contactId && !contact) throw new NotFoundException('Cliente ou fornecedor não encontrado');
    if (offeringId && !offering) throw new NotFoundException('Produto ou serviço não encontrado');
    return { contact, offering };
  }

  private async findOwnedContact(userId: string, id: string) {
    const contact = await this.prisma.businessContact.findFirst({ where: { id, userId } });
    if (!contact) throw new NotFoundException('Cliente ou fornecedor não encontrado');
    return contact;
  }

  private async findOwnedOffering(userId: string, id: string) {
    const offering = await this.prisma.businessOffering.findFirst({ where: { id, userId } });
    if (!offering) throw new NotFoundException('Produto ou serviço não encontrado');
    return offering;
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
      offering: { select: { id: true, name: true, type: true } },
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

  private sumField<T extends Record<K, unknown>, K extends keyof T>(items: T[], field: K): number {
    return items.reduce((sum, item) => sum + Number(item[field]), 0);
  }

  private dateKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  private changePercent(previous: number, current: number): number | null {
    return previous === 0 ? (current === 0 ? 0 : null) : (current - previous) / previous * 100;
  }

  private salesTiming(sales: Array<{ date: Date; revenue: number }>) {
    const days = new Map<string, { label: string; revenue: number; sales: number }>();
    const hours = new Map<string, { label: string; revenue: number; sales: number }>();
    const formatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', hour: '2-digit', hourCycle: 'h23' });
    sales.forEach((sale) => {
      const parts = formatter.formatToParts(sale.date);
      const day = parts.find((part) => part.type === 'weekday')?.value ?? '-';
      const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
      const dayRow = days.get(day) ?? { label: day, revenue: 0, sales: 0 };
      dayRow.revenue += sale.revenue; dayRow.sales += 1; days.set(day, dayRow);
      const hourKey = `${hour}:00`;
      const hourRow = hours.get(hourKey) ?? { label: hourKey, revenue: 0, sales: 0 };
      hourRow.revenue += sale.revenue; hourRow.sales += 1; hours.set(hourKey, hourRow);
    });
    const byDay = [...days.values()].sort((a, b) => b.revenue - a.revenue);
    const byHour = [...hours.values()].sort((a, b) => b.revenue - a.revenue);
    return { byDay, byHour, bestDay: byDay[0] ?? null, bestHour: byHour[0] ?? null };
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
  }
}
