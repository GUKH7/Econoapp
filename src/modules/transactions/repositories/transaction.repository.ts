import { Inject, Injectable } from '@nestjs/common';
import { FinancialScope, Prisma, Transaction, TransactionSource } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { PaginatedResult } from '@/common/types';
import { FilterTransactionDto } from '../dto/filter-transaction.dto';

interface CreateTransactionInput {
  description: string;
  amount: number;
  netAmount: number;
  type: 'INCOME' | 'EXPENSE';
  source: TransactionSource;
  scope?: FinancialScope;
  categoryId: string;
  channelId?: string;
  accountId?: string;
  creditCardId?: string;
  date?: Date;
  userId: string;
}

@Injectable()
export class TransactionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateTransactionInput): Promise<Transaction> {
    return this.prisma.$transaction(async (trx) => {
      const transaction = await trx.transaction.create({
        data: {
          ...input,
          scope: input.scope ?? 'PERSONAL',
          channelId: input.channelId ?? null,
          accountId: input.accountId ?? null,
          creditCardId: input.creditCardId ?? null,
          date: input.date ?? new Date(),
        },
      });
      if (transaction.accountId) {
        await trx.financialAccount.update({
          where: { id: transaction.accountId },
          data: {
            balance: {
              increment: this.accountBalanceEffect(transaction.type, Number(transaction.netAmount)),
            },
          },
        });
      }
      return transaction;
    });
  }

  async findById(id: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({ where: { id } });
  }


  async findAllByUser(
    userId: string,
    filters: FilterTransactionDto,
  ): Promise<PaginatedResult<Transaction>> {
    const page = Number(filters.page) > 0 ? Number(filters.page) : 1;
    const limit = Number(filters.limit) > 0 ? Number(filters.limit) : 20;

    const dateFilter: Prisma.DateTimeFilter | undefined =
      filters.startDate || filters.endDate
        ? {
            ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
            ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
          }
        : undefined;

    const where: Prisma.TransactionWhereInput = {
      userId,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.scope ? { scope: filters.scope } : {}),
      ...(filters.channelId ? { channelId: filters.channelId } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(dateFilter ? { date: dateFilter } : {}),
    };

    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(id: string, data: Prisma.TransactionUncheckedUpdateInput): Promise<Transaction> {
    return this.prisma.$transaction(async (trx) => {
      const current = await trx.transaction.findUniqueOrThrow({ where: { id } });
      const updated = await trx.transaction.update({ where: { id }, data });

      if (current.accountId) {
        await trx.financialAccount.update({
          where: { id: current.accountId },
          data: {
            balance: {
              decrement: this.accountBalanceEffect(current.type, Number(current.netAmount)),
            },
          },
        });
      }
      if (updated.accountId) {
        await trx.financialAccount.update({
          where: { id: updated.accountId },
          data: {
            balance: {
              increment: this.accountBalanceEffect(updated.type, Number(updated.netAmount)),
            },
          },
        });
      }
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.$transaction(async (trx) => {
      const current = await trx.transaction.findUniqueOrThrow({ where: { id } });
      await trx.transaction.delete({ where: { id } });
      if (current.accountId) {
        await trx.financialAccount.update({
          where: { id: current.accountId },
          data: {
            balance: {
              decrement: this.accountBalanceEffect(current.type, Number(current.netAmount)),
            },
          },
        });
      }
    });
  }

  private accountBalanceEffect(type: 'INCOME' | 'EXPENSE', amount: number): number {
    return type === 'INCOME' ? amount : -amount;
  }
}
