import { describe, expect, it, vi } from 'vitest';
import { WhatsappDataRetentionService } from '@/modules/whatsapp/whatsapp-data-retention.service';

function countResult(count: number) {
  return vi.fn().mockResolvedValue({ count });
}

describe('WhatsappDataRetentionService', () => {
  it('redige conteudo privado e remove dados conforme as janelas definidas', async () => {
    const prisma = {
      dinActivityEvent: { updateMany: countResult(2), deleteMany: countResult(1) },
      whatsappInboundMessage: { deleteMany: countResult(3) },
      whatsappOutboxMessage: { deleteMany: countResult(4) },
      whatsappConversation: { updateMany: countResult(5) },
      dinInsight: { deleteMany: countResult(6) },
    };
    const service = new WhatsappDataRetentionService(prisma as never);
    const now = new Date('2026-07-21T12:00:00.000Z');

    await expect(service.run(now)).resolves.toEqual({
      redactedEvents: 2,
      deletedEvents: 1,
      deletedInbound: 3,
      deletedOutbox: 4,
      clearedConversations: 5,
      deletedInsights: 6,
    });
    expect(prisma.dinActivityEvent.updateMany).toHaveBeenCalledWith({
      where: { redactedAt: null, retentionUntil: { lte: now } },
      data: expect.objectContaining({
        phone: null,
        messageText: null,
        audioTranscription: null,
        replyText: null,
        redactedAt: now,
      }),
    });
    expect(prisma.whatsappInboundMessage.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-06-21T12:00:00.000Z') } },
    });
    expect(prisma.whatsappConversation.updateMany).toHaveBeenCalledWith({
      where: { updatedAt: { lt: new Date('2026-04-22T12:00:00.000Z') } },
      data: expect.objectContaining({
        recentMessages: [],
        pendingText: null,
        pendingData: expect.anything(),
        stateVersion: { increment: 1 },
        appRecentMessages: [],
        appPendingText: null,
        appPendingData: expect.anything(),
        appStateVersion: { increment: 1 },
      }),
    });
  });
});
