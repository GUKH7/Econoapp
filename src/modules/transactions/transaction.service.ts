import { Inject, Injectable } from '@nestjs/common';
import { FinancialScope, Prisma, SalesChannel, Transaction, TransactionSource, TransactionType } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { calculateNetAmount } from '@/domain/finance/calculate-fees';
import { BadRequestException, NotFoundException, ForbiddenException } from '@/common/errors/app.exception';
import { createHash } from 'node:crypto';
import { PaginatedResult } from '@/common/types';
import { AccountService } from '@/modules/accounts/account.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ImportTransactionsDto } from './dto/import-transactions.dto';
import { FilterTransactionDto } from './dto/filter-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionRepository } from './repositories/transaction.repository';
import { SmartCategoryService } from './smart-category.service';

@Injectable()
export class TransactionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionRepository) private readonly transactionRepository: TransactionRepository,
    @Inject(AccountService) private readonly accountService: AccountService,
    @Inject(SmartCategoryService) private readonly smartCategoryService: SmartCategoryService,
  ) {}

  async create(
    userId: string,
    input: CreateTransactionDto & { importHash?: string; recurringRuleId?: string },
  ): Promise<Transaction> {
    if (input.type === TransactionType.INCOME && input.creditCardId) {
      throw new BadRequestException('Receitas devem ser recebidas em uma conta ou carteira');
    }

    const channel = await this.validateReferences(userId, input);
    const offering = input.offeringId
      ? await this.prisma.businessOffering.findFirst({ where: { id: input.offeringId, userId, isActive: true } })
      : null;
    if (input.offeringId && !offering) throw new BadRequestException('Produto ou serviço não encontrado');
    if (input.offeringId && (input.type !== TransactionType.INCOME || input.scope !== FinancialScope.BUSINESS)) {
      throw new BadRequestException('Produtos e serviços só podem ser vinculados a receitas do negócio');
    }

    const netAmount =
      input.type === TransactionType.INCOME && channel
        ? calculateNetAmount(input.amount, Number(channel.feePercent))
        : input.amount;

    const transaction = await this.transactionRepository.create({
      description: input.description,
      amount: input.amount,
      netAmount,
      type: input.type,
      source: input.source ?? TransactionSource.MANUAL,
      scope: input.scope ?? 'PERSONAL',
      categoryId: input.categoryId,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(offering ? { offeringId: offering.id, quantity: input.quantity ?? 1, unitCost: Number(offering.estimatedUnitCost) } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.creditCardId ? { creditCardId: input.creditCardId } : {}),
      ...(input.date ? { date: new Date(input.date) } : {}),
      userId,
      ...(input.importHash ? { importHash: input.importHash } : {}),
      ...(input.recurringRuleId ? { recurringRuleId: input.recurringRuleId } : {}),
    });

    if (input.source !== TransactionSource.CSV && input.source !== TransactionSource.RECURRENT) {
      const category = await this.prisma.category.findFirst({
        where: { id: input.categoryId, userId },
        select: { name: true },
      });
      if (category) {
        await this.smartCategoryService.remember({
          userId,
          description: input.description,
          categoryName: category.name,
          type: input.type,
        });
      }
    }

    return transaction;
  }

  async importCsv(
    userId: string,
    input: ImportTransactionsDto,
  ): Promise<{
    created: number;
    skipped: number;
    totalRows: number;
    transactions: Transaction[];
  }> {
    if (input.accountId) {
      await this.accountService.ensureAccountBelongsToUser(userId, input.accountId);
    }

    const rows = parseCsvTransactions(input.csv);
    if (!rows.length) {
      throw new BadRequestException('Nenhuma transacao valida foi encontrada no CSV');
    }

    const categories = await this.prisma.category.findMany({ where: { userId } });
    const fallbackCategory = input.categoryId
      ? categories.find((category) => category.id === input.categoryId)
      : await this.findOrCreateImportCategory(userId);

    if (!fallbackCategory) {
      throw new BadRequestException('Categoria padrao da importacao nao encontrada');
    }

    const scope = input.scope ?? FinancialScope.PERSONAL;
    const hashes = rows.map((row) => importHashFor(userId, row));
    const existing = await this.prisma.transaction.findMany({
      where: { userId, importHash: { in: hashes } },
      select: { importHash: true },
    });
    const existingHashes = new Set(existing.flatMap((item) => (item.importHash ? [item.importHash] : [])));

    let skipped = 0;
    const transactions: Transaction[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const importHash = hashes[index];
      if (!row || !importHash) continue;
      if (existingHashes.has(importHash)) {
        skipped += 1;
        continue;
      }

      const categoryId = input.categoryId ?? (await this.smartCategoryService.suggestCategoryId({
        userId,
        description: row.description,
        type: row.amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE,
        categories,
        fallbackCategoryId: fallbackCategory.id,
      }));
      const transaction = await this.create(userId, {
        description: row.description,
        amount: Math.abs(row.amount),
        type: row.amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE,
        source: TransactionSource.CSV,
        scope,
        categoryId,
        accountId: input.accountId,
        date: row.date.toISOString(),
        importHash,
      } as CreateTransactionDto & { importHash: string });
      transactions.push(transaction);
      existingHashes.add(importHash);
    }

    return { created: transactions.length, skipped, totalRows: rows.length, transactions };
  }

  private async findOrCreateImportCategory(userId: string): Promise<{ id: string; name: string }> {
    const existing = await this.prisma.category.findFirst({
      where: { userId, name: { equals: 'Importados', mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (existing) return existing;
    return this.prisma.category.create({
      data: { userId, name: 'Importados', color: '#3B82F6' },
      select: { id: true, name: true },
    });
  }

  async findAllByUser(
    userId: string,
    filter: FilterTransactionDto,
  ): Promise<PaginatedResult<Transaction>> {
    return this.transactionRepository.findAllByUser(userId, filter);
  }

  async exportCsv(userId: string, filter: FilterTransactionDto): Promise<string> {
    const dateFilter: Prisma.DateTimeFilter | undefined =
      filter.startDate || filter.endDate
        ? {
            ...(filter.startDate ? { gte: new Date(filter.startDate) } : {}),
            ...(filter.endDate ? { lte: new Date(filter.endDate) } : {}),
          }
        : undefined;

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.scope ? { scope: filter.scope } : {}),
        ...(filter.channelId ? { channelId: filter.channelId } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
      },
      include: {
        category: { select: { name: true } },
        channel: { select: { name: true } },
        account: { select: { name: true, type: true } },
        creditCard: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    });

    const header = [
      'data',
      'descricao',
      'tipo',
      'valor',
      'valor_liquido',
      'categoria',
      'conta_carteira',
      'cartao',
      'canal',
      'escopo',
      'origem',
      'id',
    ];
    const rows = transactions.map((transaction) => [
      transaction.date.toISOString().slice(0, 10),
      transaction.description,
      transaction.type,
      formatCsvNumber(Number(transaction.amount)),
      formatCsvNumber(Number(transaction.netAmount)),
      transaction.category?.name ?? '',
      transaction.account
        ? `${transaction.account.type === 'BANK' ? 'Banco' : 'Carteira'} - ${transaction.account.name}`
        : '',
      transaction.creditCard?.name ?? '',
      transaction.channel?.name ?? '',
      transaction.scope,
      transaction.source,
      transaction.id,
    ]);

    return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')}`;
  }

  async update(userId: string, id: string, input: UpdateTransactionDto): Promise<Transaction> {
    const current = await this.transactionRepository.findById(id);
    if (!current) {
      throw new NotFoundException('Transação não encontrada');
    }
    if (current.userId !== userId) {
      throw new ForbiddenException('Você não pode alterar esta transação');
    }

    const newAmount = input.amount !== undefined ? input.amount : Number(current.amount);
    const newChannelId = input.channelId !== undefined ? input.channelId : current.channelId;
    const newType = input.type !== undefined ? input.type : current.type;
    const newCreditCardId =
      input.creditCardId !== undefined ? input.creditCardId : current.creditCardId;
    const newOfferingId = input.offeringId !== undefined ? input.offeringId : current.offeringId;

    if (newType === TransactionType.INCOME && newCreditCardId) {
      throw new BadRequestException('Receitas devem ser recebidas em uma conta ou carteira');
    }

    const channel = await this.validateReferences(userId, {
      categoryId: input.categoryId !== undefined ? input.categoryId : current.categoryId,
      channelId: newChannelId,
      accountId: input.accountId !== undefined ? input.accountId : current.accountId,
      creditCardId: newCreditCardId,
    });
    const offering = newOfferingId
      ? await this.prisma.businessOffering.findFirst({ where: { id: newOfferingId, userId, isActive: true } })
      : null;
    if (newOfferingId && !offering) throw new BadRequestException('Produto ou serviço não encontrado');
    if (newOfferingId && (newType !== TransactionType.INCOME || (input.scope ?? current.scope) !== FinancialScope.BUSINESS)) {
      throw new BadRequestException('Produtos e serviços só podem ser vinculados a receitas do negócio');
    }

    let newNetAmount: number = Number(current.netAmount);
    if (input.amount !== undefined || input.channelId !== undefined || input.type !== undefined) {
      if (newType === TransactionType.INCOME && newChannelId) {
        newNetAmount = calculateNetAmount(newAmount, Number(channel?.feePercent ?? 0));
      } else {
        newNetAmount = newAmount;
      }
    }

    return this.transactionRepository.update(id, {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
      ...(input.offeringId !== undefined ? { offeringId: input.offeringId, unitCost: offering ? Number(offering.estimatedUnitCost) : null } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.creditCardId !== undefined ? { creditCardId: input.creditCardId } : {}),
      ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
      netAmount: newNetAmount,
    });
  }

  async findOneByUser(userId: string, id: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findById(id);
    if (!transaction) throw new NotFoundException('Transação não encontrada');
    if (transaction.userId !== userId)
      throw new ForbiddenException('Você não tem acesso a esta transação');
    return transaction;
  }

  async delete(userId: string, id: string): Promise<void> {
    const current = await this.transactionRepository.findById(id);
    if (!current) {
      throw new NotFoundException('Transação não encontrada');
    }
    if (current.userId !== userId) {
      throw new ForbiddenException('Você não pode remover esta transação');
    }

    await this.transactionRepository.delete(id);
  }

  private async validateReferences(
    userId: string,
    references: {
      categoryId?: string | null;
      channelId?: string | null;
      accountId?: string | null;
      creditCardId?: string | null;
    },
  ): Promise<SalesChannel | null> {
    const [category, channel] = await Promise.all([
      references.categoryId
        ? this.prisma.category.findFirst({
            where: { id: references.categoryId, userId },
            select: { id: true },
          })
        : null,
      references.channelId
        ? this.prisma.salesChannel.findFirst({ where: { id: references.channelId, userId } })
        : null,
    ]);

    if (references.categoryId && !category) {
      throw new BadRequestException('Categoria não encontrada para este usuário');
    }
    if (references.channelId && !channel) {
      throw new BadRequestException('Canal de venda não encontrado para este usuário');
    }

    await Promise.all([
      references.accountId
        ? this.accountService.ensureAccountBelongsToUser(userId, references.accountId)
        : Promise.resolve(),
      references.creditCardId
        ? this.accountService.ensureCardBelongsToUser(userId, references.creditCardId)
        : Promise.resolve(),
    ]);

    return channel;
  }
}
interface ParsedCsvTransaction {
  date: Date;
  description: string;
  amount: number;
}

function parseCsvTransactions(csv: string): ParsedCsvTransaction[] {
  const records = parseCsv(csv).filter((row) => row.some((cell) => cell.trim()));
  if (records.length < 2) return [];

  const headerRow = records[0];
  if (!headerRow) return [];
  const headers = headerRow.map((header) => normalizeHeader(header));
  const dateIndex = findHeader(headers, ['data', 'date', 'dt', 'postedat']);
  const descriptionIndex = findHeader(headers, ['descricao', 'description', 'historico', 'memo', 'lancamento', 'titulo']);
  const amountIndex = findHeader(headers, ['valor', 'amount', 'quantia', 'total']);
  const typeIndex = findHeader(headers, ['tipo', 'type', 'natureza']);

  if (dateIndex < 0 || descriptionIndex < 0 || amountIndex < 0) {
    throw new BadRequestException('CSV precisa ter colunas de data, descricao e valor');
  }

  return records.slice(1).flatMap((record) => {
    const date = parseDate(record[dateIndex] ?? '');
    const description = (record[descriptionIndex] ?? '').trim();
    let amount = parseMoney(record[amountIndex] ?? '');
    const type = (record[typeIndex] || '').toLowerCase();
    if (type && /saida|debito|debit|expense|despesa|gasto/.test(normalizeText(type))) {
      amount = -Math.abs(amount);
    }
    if (type && /entrada|credito|credit|income|receita/.test(normalizeText(type))) {
      amount = Math.abs(amount);
    }
    if (!date || !description || !Number.isFinite(amount) || amount === 0) return [];
    return [{ date, description, amount }];
  });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (char === ',' || char === ';' || char === '\t')) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}

function normalizeHeader(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function parseDate(value: string): Date | null {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return safeDate(Number(iso[1] ?? 0), Number(iso[2] ?? 0), Number(iso[3] ?? 0));
  const br = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (br) {
    const day = br[1] ?? '';
    const month = br[2] ?? '';
    const rawYear = br[3] ?? '';
    const year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
    return safeDate(year, Number(month), Number(day));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMoney(value: string): number {
  const cleaned = value.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return Number.NaN;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  return Number(cleaned.replace(/,/g, ''));
}

function csvCell(value: string | number): string {
  const text = String(value ?? '');
  const escaped = text.replace(/"/g, '""');
  return /[;"\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function formatCsvNumber(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

function importHashFor(userId: string, row: ParsedCsvTransaction): string {
  return createHash('sha256')
    .update([userId, row.date.toISOString().slice(0, 10), row.description.trim().toLowerCase(), row.amount.toFixed(2)].join('|'))
    .digest('hex');
}
