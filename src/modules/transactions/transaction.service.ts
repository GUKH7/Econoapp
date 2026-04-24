import { Inject, Injectable } from '@nestjs/common';
import { Transaction, TransactionSource, TransactionType } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { calculateNetAmount } from '@/domain/finance/calculate-fees';
import { NotFoundException, ForbiddenException } from '@/common/errors/app.exception';
import { PaginatedResult } from '@/common/types';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { FilterTransactionDto } from './dto/filter-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionRepository } from './repositories/transaction.repository';

@Injectable()
export class TransactionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionRepository) private readonly transactionRepository: TransactionRepository,
  ) {}

  async create(userId: string, input: CreateTransactionDto): Promise<Transaction> {
    const channel = input.channelId
      ? await this.prisma.salesChannel.findFirst({ where: { id: input.channelId, userId } })
      : null;

    const netAmount =
      input.type === TransactionType.INCOME && channel
        ? calculateNetAmount(input.amount, Number(channel.feePercent))
        : input.amount;

    return this.transactionRepository.create({
      description: input.description,
      amount: input.amount,
      netAmount,
      type: input.type,
      source: input.source ?? TransactionSource.MANUAL,
      categoryId: input.categoryId,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.date ? { date: new Date(input.date) } : {}),
      userId,
    });
  }

  async findAllByUser(
    userId: string,
    filter: FilterTransactionDto,
  ): Promise<PaginatedResult<Transaction>> {
    return this.transactionRepository.findAllByUser(userId, filter);
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

    let newNetAmount: number = Number(current.netAmount);
    if (input.amount !== undefined || input.channelId !== undefined || input.type !== undefined) {
      if (newType === TransactionType.INCOME && newChannelId) {
        const channel = await this.prisma.salesChannel.findFirst({
          where: { id: newChannelId, userId },
        });
        newNetAmount = channel
          ? calculateNetAmount(newAmount, Number(channel.feePercent))
          : newAmount;
      } else {
        newNetAmount = newAmount;
      }
    }

    return this.transactionRepository.update(id, {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
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
}
