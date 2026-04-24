import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Transaction } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { PaginatedResult } from '@/common/types';
import { FilterTransactionDto } from '../dto/filter-transaction.dto';

interface CreateTransactionInput {
  description: string;
  amount: number;
  netAmount: number;
  type: 'INCOME' | 'EXPENSE';
  source: 'MANUAL' | 'WHATSAPP' | 'AUDIO';
  categoryId: string;
  channelId?: string;
  date?: Date;
  userId: string;
  whatsappMessageId?: string;
}

@Injectable()
export class TransactionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateTransactionInput): Promise<Transaction> {
    return this.prisma.$transaction((trx) =>
      trx.transaction.create({
        data: {
          ...input,
          channelId: input.channelId ?? null,
          date: input.date ?? new Date(),
          whatsappMessageId: input.whatsappMessageId ?? null,
        },
      }),
    );
  }

  async findById(id: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({ where: { id } });
  }

  async findByWhatsappMessageId(messageId: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({ where: { whatsappMessageId: messageId } });
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
    return this.prisma.transaction.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.transaction.delete({ where: { id } });
  }
}
