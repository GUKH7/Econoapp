import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionSource, TransactionType } from '@prisma/client';
import { TransactionRepository } from '@/modules/transactions/repositories/transaction.repository';

describe('TransactionRepository account balances', () => {
  let repository: TransactionRepository;
  let trx: {
    transaction: {
      create: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    financialAccount: {
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    trx = {
      transaction: {
        create: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      financialAccount: {
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof trx) => unknown) => callback(trx)),
    };
    repository = new TransactionRepository(prisma as never);
  });

  it('incrementa o saldo ao criar uma receita em uma conta', async () => {
    trx.transaction.create.mockResolvedValue({
      id: 'income-1',
      accountId: 'account-1',
      type: TransactionType.INCOME,
      netAmount: 100,
    });

    await repository.create({
      description: 'Serviço',
      amount: 100,
      netAmount: 100,
      type: TransactionType.INCOME,
      source: TransactionSource.WHATSAPP,
      scope: 'PERSONAL',
      categoryId: 'category-1',
      accountId: 'account-1',
      userId: 'user-1',
    });

    expect(trx.financialAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { balance: { increment: 100 } },
    });
  });

  it('reduz o saldo ao criar uma despesa em uma conta ou carteira', async () => {
    trx.transaction.create.mockResolvedValue({
      id: 'expense-1',
      accountId: 'wallet-1',
      type: TransactionType.EXPENSE,
      netAmount: 40,
    });

    await repository.create({
      description: 'Almoço',
      amount: 40,
      netAmount: 40,
      type: TransactionType.EXPENSE,
      source: TransactionSource.WHATSAPP,
      scope: 'PERSONAL',
      categoryId: 'category-1',
      accountId: 'wallet-1',
      userId: 'user-1',
    });

    expect(trx.financialAccount.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { balance: { increment: -40 } },
    });
  });

  it('reverte o efeito anterior e aplica o novo ao editar', async () => {
    trx.transaction.findUniqueOrThrow.mockResolvedValue({
      id: 'expense-1',
      accountId: 'account-1',
      type: TransactionType.EXPENSE,
      netAmount: 20,
    });
    trx.transaction.update.mockResolvedValue({
      id: 'expense-1',
      accountId: 'account-1',
      type: TransactionType.EXPENSE,
      netAmount: 25,
    });

    await repository.update('expense-1', { amount: 25, netAmount: 25 });

    expect(trx.financialAccount.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'account-1' },
      data: { balance: { decrement: -20 } },
    });
    expect(trx.financialAccount.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'account-1' },
      data: { balance: { increment: -25 } },
    });
  });

  it('devolve o valor ao saldo quando uma despesa e excluida', async () => {
    trx.transaction.findUniqueOrThrow.mockResolvedValue({
      id: 'expense-1',
      accountId: 'account-1',
      type: TransactionType.EXPENSE,
      netAmount: 20,
    });

    await repository.delete('expense-1');

    expect(trx.transaction.delete).toHaveBeenCalledWith({ where: { id: 'expense-1' } });
    expect(trx.financialAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { balance: { decrement: -20 } },
    });
  });

  it('nao altera conta bancaria quando a despesa usa cartao', async () => {
    trx.transaction.create.mockResolvedValue({
      id: 'expense-card',
      accountId: null,
      creditCardId: 'card-1',
      type: TransactionType.EXPENSE,
      netAmount: 50,
    });

    await repository.create({
      description: 'Compra no cartão',
      amount: 50,
      netAmount: 50,
      type: TransactionType.EXPENSE,
      source: TransactionSource.WHATSAPP,
      scope: 'PERSONAL',
      categoryId: 'category-1',
      creditCardId: 'card-1',
      userId: 'user-1',
    });

    expect(trx.financialAccount.update).not.toHaveBeenCalled();
  });
});
