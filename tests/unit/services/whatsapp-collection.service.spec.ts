import { describe, expect, it, vi } from 'vitest';
import { BusinessEntryStatus, BusinessEntryType } from '@prisma/client';
import { WhatsappCollectionService } from '@/modules/whatsapp/whatsapp-collection.service';

describe('WhatsappCollectionService', () => {
  it('valida propriedade e envia cobrança pela outbox', async () => {
    const prisma = {
      businessEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry-1', userId: 'user-1', type: BusinessEntryType.RECEIVABLE,
          status: BusinessEntryStatus.PENDING, title: 'Projeto de design', amount: 350,
          dueDate: new Date('2026-07-25T00:00:00Z'), counterparty: 'Cliente Aurora',
          contact: { name: 'Cliente Aurora', phone: '(11) 99999-9999' },
          user: { name: 'Loja Din' },
        }),
      },
    };
    const queue = { enqueueOutbound: vi.fn().mockResolvedValue({ id: 'outbox-1' }) };
    const service = new WhatsappCollectionService(prisma as never, queue as never);

    await expect(service.sendReceivableReminder('user-1', 'entry-1')).resolves.toEqual({
      queued: true, outboxId: 'outbox-1', phone: '5511999999999',
    });
    expect(prisma.businessEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'entry-1', userId: 'user-1' },
    }));
    expect(queue.enqueueOutbound).toHaveBeenCalledWith(expect.objectContaining({
      phone: '5511999999999',
      message: expect.stringContaining('R$ 350,00'),
    }));
  });
});
