import { AccountAccessStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '@/modules/admin/admin.service';
import { PrismaService } from '@/config/database';

describe('AdminService', () => {
  let service: AdminService;
  // O mock replica apenas os métodos do Prisma usados por este serviço.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: {
        count: vi.fn(),
        groupBy: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      payment: { aggregate: vi.fn(), findMany: vi.fn() },
      $transaction: vi.fn(async (callback) => callback({
        payment: { create: vi.fn().mockResolvedValue({ id: 'payment-1' }) },
        user: { update: vi.fn().mockResolvedValue({ id: 'user-1' }) },
      })),
    };
    service = new AdminService(prisma as PrismaService);
  });

  it('resume usuários e pagamentos do mês', async () => {
    prisma.user.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(2);
    prisma.user.groupBy.mockResolvedValue([
      { accessStatus: AccountAccessStatus.PENDING, _count: { id: 3 } },
      { accessStatus: AccountAccessStatus.ACTIVE, _count: { id: 8 } },
      { accessStatus: AccountAccessStatus.SUSPENDED, _count: { id: 1 } },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 249.5 }, _count: { id: 5 } });

    await expect(service.overview()).resolves.toMatchObject({
      totalUsers: 12,
      pendingUsers: 3,
      activeUsers: 8,
      suspendedUsers: 1,
      expiredUsers: 2,
      monthlyRevenue: 249.5,
      monthlyPayments: 5,
    });
  });

  it('registra pagamento e ativa o usuário na mesma transação', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    const result = await service.recordPayment('admin-1', 'user-1', {
      amount: 49.9,
      validUntil: '2026-08-18T23:59:59.999Z',
      notes: 'Mensalidade',
    });

    expect(result).toEqual({ id: 'payment-1' });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('não permite suspender o próprio administrador', async () => {
    await expect(service.updateAccess('admin-1', 'admin-1', AccountAccessStatus.SUSPENDED))
      .rejects.toThrow('próprio acesso administrativo');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('não permite excluir a própria conta administrativa', async () => {
    await expect(service.deleteUser('admin-1', 'admin-1'))
      .rejects.toThrow('própria conta administrativa');
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});
