import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/database';
import { CreateCreditCardDto } from '../dto/create-credit-card.dto';
import { CreateFinancialAccountDto } from '../dto/create-financial-account.dto';
import { UpdateCreditCardDto } from '../dto/update-credit-card.dto';
import { UpdateFinancialAccountDto } from '../dto/update-financial-account.dto';

@Injectable()
export class AccountRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  createAccount(userId: string, input: CreateFinancialAccountDto) {
    return this.prisma.financialAccount.create({
      data: {
        ...input,
        balance: input.balance ?? 0,
        scope: input.scope ?? 'PERSONAL',
        isActive: input.isActive ?? true,
        userId,
      },
    });
  }

  findAccountsByUser(userId: string) {
    return this.prisma.financialAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findAccountById(userId: string, id: string) {
    return this.prisma.financialAccount.findFirst({ where: { id, userId } });
  }

  updateAccount(userId: string, id: string, input: UpdateFinancialAccountDto) {
    return this.prisma.financialAccount.updateMany({ where: { id, userId }, data: input });
  }

  async deleteAccount(userId: string, id: string): Promise<void> {
    await this.prisma.financialAccount.deleteMany({ where: { id, userId } });
  }

  createCard(userId: string, input: CreateCreditCardDto) {
    return this.prisma.creditCard.create({
      data: {
        ...input,
        limit: input.limit ?? 0,
        scope: input.scope ?? 'PERSONAL',
        isActive: input.isActive ?? true,
        userId,
      },
    });
  }

  findCardsByUser(userId: string) {
    return this.prisma.creditCard.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findCardById(userId: string, id: string) {
    return this.prisma.creditCard.findFirst({ where: { id, userId } });
  }

  updateCard(userId: string, id: string, input: UpdateCreditCardDto) {
    return this.prisma.creditCard.updateMany({ where: { id, userId }, data: input });
  }

  async deleteCard(userId: string, id: string): Promise<void> {
    await this.prisma.creditCard.deleteMany({ where: { id, userId } });
  }
}
