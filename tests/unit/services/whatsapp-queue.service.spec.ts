import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsappQueueService } from '@/modules/whatsapp/whatsapp-queue.service';

function createPrismaMock() {
  return {
    whatsappInboundMessage: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    whatsappOutboxMessage: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
    },
    dinActivityEvent: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

function createWhatsappServiceMock() {
  return { handleWebhook: vi.fn() };
}

function createProviderClientMock() {
  return { sendMessage: vi.fn() };
}

describe('WhatsappQueueService', () => {
  let service: WhatsappQueueService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let whatsappService: ReturnType<typeof createWhatsappServiceMock>;
  let providerClient: ReturnType<typeof createProviderClientMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    whatsappService = createWhatsappServiceMock();
    providerClient = createProviderClientMock();
    service = new WhatsappQueueService(prisma as never, whatsappService as never, providerClient as never);
  });

  it('persiste o messageId enviado pelo provedor e aceita rapidamente', async () => {
    prisma.whatsappInboundMessage.create.mockResolvedValue({ id: 'inbound-1' });
    const result = await service.ingest({
      from: '5511999999999',
      text: 'Oi',
      data: { messageId: 'provider-message-1' },
    });
    expect(result).toEqual({ received: true, duplicate: false, messageId: 'provider-message-1' });
    expect(prisma.whatsappInboundMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'BAILEYS',
        externalMessageId: 'provider-message-1',
        phone: '5511999999999',
      }),
    });
  });

  it('ignora o mesmo evento quando o índice único acusa duplicidade', async () => {
    prisma.whatsappInboundMessage.create.mockRejectedValue({ code: 'P2002' });
    const result = await service.ingest({
      from: '5511999999999',
      text: 'Oi',
      data: { messageId: 'provider-message-1' },
    });
    expect(result.duplicate).toBe(true);
    expect(whatsappService.handleWebhook).not.toHaveBeenCalled();
  });

  it('rejeita eventos sem messageId para não processar sem idempotência', async () => {
    await expect(service.ingest({ from: '5511999999999', text: 'Oi' }))
      .rejects.toThrow(BadRequestException);
  });

  it('registra confirmação de leitura sem regredir o estado', async () => {
    prisma.whatsappOutboxMessage.findUnique.mockResolvedValue({
      id: 'out-1',
      status: 'DELIVERED',
      attempts: 2,
      inboundMessage: { provider: 'BAILEYS', externalMessageId: 'provider-in-1' },
    });
    prisma.whatsappOutboxMessage.update.mockResolvedValue({});
    await expect(service.applyDelivery({ messageId: 'provider-out-1', status: 'READ' }))
      .resolves.toEqual({ updated: true });
    expect(prisma.whatsappOutboxMessage.update).toHaveBeenCalledWith({
      where: { id: 'out-1' },
      data: expect.objectContaining({ status: 'READ', readAt: expect.any(Date) }),
    });
    expect(prisma.dinActivityEvent.updateMany).toHaveBeenCalledWith({
      where: { provider: 'BAILEYS', externalMessageId: 'provider-in-1' },
      data: expect.objectContaining({ sendStatus: 'READ', attempts: 2 }),
    });
  });

  it('envia a outbox com chave idempotente e persiste o messageId do provedor', async () => {
    const outbox = {
      id: 'outbox-1',
      phone: '5511999999999',
      message: 'Resposta do Din',
      status: 'SENDING',
      attempts: 1,
    };
    prisma.whatsappInboundMessage.updateMany.mockResolvedValue({ count: 0 });
    prisma.whatsappOutboxMessage.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.whatsappOutboxMessage.findFirst
      .mockResolvedValueOnce({ ...outbox, status: 'PENDING' })
      .mockResolvedValueOnce(null);
    prisma.whatsappOutboxMessage.findUnique.mockResolvedValue(outbox);
    prisma.whatsappOutboxMessage.update.mockResolvedValue({});
    providerClient.sendMessage.mockResolvedValue({ messageId: 'provider-outbox-1' });

    await service.tick();

    expect(providerClient.sendMessage).toHaveBeenCalledWith({
      phone: outbox.phone,
      message: outbox.message,
      idempotencyKey: outbox.id,
    });
    expect(prisma.whatsappOutboxMessage.update).toHaveBeenCalledWith({
      where: { id: outbox.id },
      data: expect.objectContaining({ status: 'SENT', providerMessageId: 'provider-outbox-1' }),
    });
  });

  it('avisa quando uma solicitação provavelmente dependerá de IA', () => {
    const needsNotice = Reflect.get(service, 'needsProcessingNotice') as (payload: unknown) => boolean;
    expect(needsNotice.call(service, {
      text: 'Você consegue analisar por que meus gastos aumentaram tanto neste mês?',
    })).toBe(true);
    expect(needsNotice.call(service, { text: 'Gastei 20 no mercado' })).toBe(false);
    expect(needsNotice.call(service, { audio: { base64: 'abc' } })).toBe(false);
  });
});
