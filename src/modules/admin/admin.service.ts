import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccountAccessStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [totalUsers, grouped, expiredUsers, revenue] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.groupBy({ by: ['accessStatus'], _count: { id: true } }),
      this.prisma.user.count({
        where: { accessStatus: AccountAccessStatus.ACTIVE, paidUntil: { lt: now } },
      }),
      this.prisma.payment.aggregate({
        where: { paidAt: { gte: monthStart } },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);
    const count = (status: AccountAccessStatus) =>
      grouped.find((item) => item.accessStatus === status)?._count.id ?? 0;
    return {
      totalUsers,
      pendingUsers: count(AccountAccessStatus.PENDING),
      activeUsers: count(AccountAccessStatus.ACTIVE),
      suspendedUsers: count(AccountAccessStatus.SUSPENDED),
      expiredUsers,
      monthlyRevenue: Number(revenue._sum.amount ?? 0),
      monthlyPayments: revenue._count.id,
    };
  }

  async listUsers(query: AdminUserQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { accessStatus: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ accessStatus: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          accessStatus: true,
          paidUntil: true,
          createdAt: true,
          _count: { select: { transactions: true, payments: true } },
          payments: {
            orderBy: { paidAt: 'desc' },
            take: 1,
            select: { amount: true, paidAt: true, validUntil: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: users.map((user) => ({
        ...user,
        lastPayment: user.payments[0] ?? null,
        payments: undefined,
        isExpired: Boolean(user.paidUntil && user.paidUntil < new Date()),
      })),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async updateAccess(adminId: string, userId: string, status: AccountAccessStatus) {
    if (adminId === userId && status !== AccountAccessStatus.ACTIVE) {
      throw new BadRequestException('Você não pode suspender o próprio acesso administrativo.');
    }
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Usuário não encontrado');
    return this.prisma.user.update({
      where: { id: userId },
      data: { accessStatus: status },
      select: { id: true, accessStatus: true, paidUntil: true },
    });
  }

  async recordPayment(adminId: string, userId: string, input: RecordPaymentDto) {
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const validUntil = new Date(input.validUntil);
    if (validUntil <= paidAt) throw new BadRequestException('A validade deve ser posterior ao pagamento.');
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Usuário não encontrado');

    return this.prisma.$transaction(async (transaction) => {
      const payment = await transaction.payment.create({
        data: {
          userId,
          recordedById: adminId,
          amount: input.amount,
          paidAt,
          validUntil,
          notes: input.notes?.trim() || null,
        },
      });
      await transaction.user.update({
        where: { id: userId },
        data: { accessStatus: AccountAccessStatus.ACTIVE, paidUntil: validUntil },
      });
      return payment;
    });
  }

  async paymentHistory(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { paidAt: 'desc' },
      select: { id: true, amount: true, paidAt: true, validUntil: true, notes: true, createdAt: true },
    });
  }

  async deleteUser(adminId: string, userId: string): Promise<void> {
    if (adminId === userId) throw new BadRequestException('Você não pode excluir a própria conta administrativa.');
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Usuário não encontrado');
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
