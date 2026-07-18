import {
  BusinessEntryStatus,
  BusinessEntryType,
  FinancialScope,
  ScheduledNotificationType,
  TransactionType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsappScheduledNotificationService } from '@/modules/whatsapp/whatsapp-scheduled-notification.service';

describe('WhatsappScheduledNotificationService', () => {
  const referenceDate = new Date('2026-06-13T12:00:00.000Z');
  const prismaMock = {
    transaction: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    creditCard: {
      findMany: vi.fn(),
    },
    businessEntry: {
      findMany: vi.fn(),
    },
    scheduledNotificationDelivery: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  const whatsappMock = {
    sendMessage: vi.fn(),
  };
  let service: WhatsappScheduledNotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.transaction.findMany.mockResolvedValue([]);
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prismaMock.creditCard.findMany.mockResolvedValue([]);
    prismaMock.businessEntry.findMany.mockResolvedValue([]);
    prismaMock.scheduledNotificationDelivery.findUnique.mockResolvedValue(null);
    prismaMock.scheduledNotificationDelivery.create.mockResolvedValue({ id: 'delivery-1' });
    whatsappMock.sendMessage.mockResolvedValue({ success: true });
    service = new WhatsappScheduledNotificationService(prismaMock as never, whatsappMock as never);
  });

  it('envia lembrete de conta três dias antes do vencimento', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 'transaction-1',
        userId: 'user-1',
        type: TransactionType.EXPENSE,
        scope: FinancialScope.PERSONAL,
        description: 'Conta de energia',
        amount: 180.5,
        date: new Date('2026-06-16T10:00:00.000Z'),
        user: { phone: '11999990000' },
        category: { name: 'Moradia' },
        account: { name: 'Conta principal' },
        creditCard: null,
      },
    ]);

    const result = await service.run(referenceDate);

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(whatsappMock.sendMessage).toHaveBeenCalledWith({
      phone: '5511999990000',
      message: expect.stringContaining('Sua conta vence em 3 dias'),
    });
    expect(prismaMock.scheduledNotificationDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: ScheduledNotificationType.BILL_DUE,
        notificationKey: 'BILL_DUE:transaction-1:2026-06-16:3',
      }),
    });
  });

  it('avisa pelo WhatsApp sobre recebimento empresarial vencido', async () => {
    prismaMock.businessEntry.findMany.mockResolvedValue([
      {
        id: 'business-entry-1',
        userId: 'user-1',
        type: BusinessEntryType.RECEIVABLE,
        status: BusinessEntryStatus.PENDING,
        title: 'Projeto Aurora',
        counterparty: 'Cliente Aurora',
        amount: 1200,
        dueDate: new Date('2026-06-12T10:00:00.000Z'),
        user: { phone: '11999990000' },
      },
    ]);

    const result = await service.run(referenceDate);

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(whatsappMock.sendMessage).toHaveBeenCalledWith({
      phone: '5511999990000',
      message: expect.stringContaining('receber de Cliente Aurora'),
    });
    expect(prismaMock.scheduledNotificationDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: ScheduledNotificationType.BUSINESS_RECEIVABLE_DUE,
      }),
    });
  });

  it('identifica uma parcela que vence hoje', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 'transaction-2',
        userId: 'user-1',
        type: TransactionType.EXPENSE,
        scope: FinancialScope.BUSINESS,
        description: 'Notebook (2/10)',
        amount: 350,
        date: new Date('2026-06-13T10:00:00.000Z'),
        user: { phone: '5511999990000' },
        category: { name: 'Equipamentos' },
        account: null,
        creditCard: { name: 'Cartão empresarial' },
      },
    ]);

    const result = await service.run(referenceDate);

    expect(result.sent).toBe(1);
    expect(whatsappMock.sendMessage).toHaveBeenCalledWith({
      phone: '5511999990000',
      message: expect.stringMatching(/Sua parcela vence hoje[\s\S]*Modo: Negócio/),
    });
    expect(prismaMock.scheduledNotificationDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: ScheduledNotificationType.INSTALLMENT_DUE }),
    });
  });

  it('não reenvia uma notificação já registrada', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 'transaction-3',
        userId: 'user-1',
        type: TransactionType.EXPENSE,
        scope: FinancialScope.PERSONAL,
        description: 'Internet',
        amount: 99.9,
        date: new Date('2026-06-13T10:00:00.000Z'),
        user: { phone: '11999990000' },
        category: { name: 'Assinaturas' },
        account: { name: 'Carteira' },
        creditCard: null,
      },
    ]);
    prismaMock.scheduledNotificationDelivery.findUnique.mockResolvedValue({ id: 'existing' });

    const result = await service.run(referenceDate);

    expect(result).toEqual({ checked: 1, sent: 0, skipped: 1, failed: 0 });
    expect(whatsappMock.sendMessage).not.toHaveBeenCalled();
  });

  it('envia o total da fatura três dias antes do vencimento', async () => {
    prismaMock.creditCard.findMany.mockResolvedValue([
      {
        id: 'card-1',
        userId: 'user-1',
        name: 'Nubank',
        dueDay: 16,
        scope: FinancialScope.PERSONAL,
        user: { phone: '11999990000' },
      },
    ]);
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: 850.75 } });

    const result = await service.run(referenceDate);

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(whatsappMock.sendMessage).toHaveBeenCalledWith({
      phone: '5511999990000',
      message: expect.stringMatching(/fatura do cartão Nubank vence em 3 dias[\s\S]*850,75/),
    });
    expect(prismaMock.scheduledNotificationDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: ScheduledNotificationType.CREDIT_CARD_DUE,
        notificationKey: 'CREDIT_CARD_DUE:card-1:2026-06-16:3',
      }),
    });
  });
});
