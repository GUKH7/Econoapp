import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, WhatsappInboundMessage, WhatsappOutboxMessage, WhatsappOutboxStatus } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { env } from '@/config/env';
import { WhatsappDeliveryDto } from './dto/whatsapp-delivery.dto';
import { WhatsappWebhookDto } from './dto/whatsapp-webhook.dto';
import { WhatsappProviderClient } from './whatsapp-provider.client';
import { WhatsappService } from './whatsapp.service';
import { sanitizeWhatsappPayload } from './whatsapp-payload-sanitizer';
import { WhatsappSpeechService } from './whatsapp-speech.service';

const MAX_ATTEMPTS = 5;
const STALE_LOCK_MS = 2 * 60_000;

@Injectable()
export class WhatsappQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappQueueService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WhatsappService) private readonly whatsappService: WhatsappService,
    @Inject(WhatsappProviderClient) private readonly providerClient: WhatsappProviderClient,
    @Optional() @Inject(WhatsappSpeechService) private readonly speechService?: WhatsappSpeechService,
  ) {}

  onModuleInit(): void {
    if (env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async ingest(payload: WhatsappWebhookDto): Promise<{
    received: true;
    duplicate: boolean;
    messageId: string;
  }> {
    const messageId = this.extractMessageId(payload);
    const phone = this.extractPhone(payload);
    if (!messageId) throw new BadRequestException('Webhook WhatsApp precisa informar messageId.');
    if (!phone) throw new BadRequestException('Webhook WhatsApp precisa informar telefone.');

    try {
      await this.prisma.whatsappInboundMessage.create({
        data: {
          provider: 'BAILEYS',
          externalMessageId: messageId,
          phone,
          payload: this.toJsonValue(payload),
        },
      });
      void this.tick();
      return { received: true, duplicate: false, messageId };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      return { received: true, duplicate: true, messageId };
    }
  }

  async enqueueOutbound(input: {
    phone: string;
    message: string;
    interactions?: Array<{ id: string; label: string; value: string }>;
  }): Promise<{ id: string }> {
    const created = await this.prisma.whatsappOutboxMessage.create({
      data: {
        phone: input.phone.replace(/\D/g, ''),
        message: input.message,
        ...(input.interactions?.length
          ? { interactions: input.interactions.slice(0, 3) as unknown as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true },
    });
    void this.tick();
    return created;
  }

  async applyDelivery(dto: WhatsappDeliveryDto): Promise<{ updated: boolean }> {
    const current = await this.prisma.whatsappOutboxMessage.findUnique({
      where: { providerMessageId: dto.messageId },
      select: {
        id: true,
        status: true,
        attempts: true,
        inboundMessage: { select: { provider: true, externalMessageId: true } },
      },
    });
    if (!current) return { updated: false };

    const next = this.deliveryStatus(current.status, dto.status);
    await this.prisma.whatsappOutboxMessage.update({
      where: { id: current.id },
      data: {
        status: next,
        ...(next === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(next === 'READ' ? { readAt: new Date(), deliveredAt: new Date() } : {}),
        ...(next === 'FAILED' ? { lastError: 'O provedor informou falha na entrega.' } : {}),
      },
    });
    await this.updateActivityDelivery(current.inboundMessage, {
      sendStatus: next,
      attempts: current.attempts,
      ...(next === 'FAILED' ? { errorCode: 'PROVIDER_DELIVERY_FAILED' } : {}),
    });
    return { updated: true };
  }

  async status(): Promise<{
    inbound: Record<string, number>;
    outbox: Record<string, number>;
    deadLetters: Array<{ id: string; kind: 'INBOUND' | 'OUTBOX'; attempts: number; error: string | null; createdAt: string }>;
  }> {
    const [inboundGroups, outboxGroups, inboundDead, outboxDead] = await Promise.all([
      this.prisma.whatsappInboundMessage.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.whatsappOutboxMessage.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.whatsappInboundMessage.findMany({
        where: { status: 'DEAD_LETTER' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, attempts: true, lastError: true, createdAt: true },
      }),
      this.prisma.whatsappOutboxMessage.findMany({
        where: { status: 'DEAD_LETTER' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, attempts: true, lastError: true, createdAt: true },
      }),
    ]);
    return {
      inbound: Object.fromEntries(inboundGroups.map((item) => [item.status, item._count._all])),
      outbox: Object.fromEntries(outboxGroups.map((item) => [item.status, item._count._all])),
      deadLetters: [
        ...inboundDead.map((item) => ({
          id: item.id,
          kind: 'INBOUND' as const,
          attempts: item.attempts,
          error: item.lastError,
          createdAt: item.createdAt.toISOString(),
        })),
        ...outboxDead.map((item) => ({
          id: item.id,
          kind: 'OUTBOX' as const,
          attempts: item.attempts,
          error: item.lastError,
          createdAt: item.createdAt.toISOString(),
        })),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 20),
    };
  }

  async retryDeadLetter(kind: 'INBOUND' | 'OUTBOX', id: string): Promise<{ queued: boolean }> {
    const queued = kind === 'INBOUND'
      ? await this.prisma.whatsappInboundMessage.updateMany({
          where: { id, status: 'DEAD_LETTER' },
          data: { status: 'FAILED', attempts: 0, availableAt: new Date(), lockedAt: null, lastError: null },
        })
      : await this.prisma.whatsappOutboxMessage.updateMany({
          where: { id, status: 'DEAD_LETTER' },
          data: {
            status: 'FAILED',
            attempts: 0,
            availableAt: new Date(),
            lockedAt: null,
            deadLetteredAt: null,
            lastError: null,
          },
        });
    if (queued.count) void this.tick();
    return { queued: queued.count === 1 };
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverStaleLocks();
      for (let index = 0; index < 5; index += 1) {
        const inbound = await this.claimInbound();
        if (!inbound) break;
        await this.processInbound(inbound);
      }
      for (let index = 0; index < 10; index += 1) {
        const outbox = await this.claimOutbox();
        if (!outbox) break;
        await this.deliverOutbox(outbox);
      }
    } catch (error) {
      this.logger.error('Falha no worker persistente do WhatsApp.', this.errorMessage(error));
    } finally {
      this.running = false;
    }
  }

  private async claimInbound(): Promise<WhatsappInboundMessage | null> {
    const candidates = await this.prisma.whatsappInboundMessage.findMany({
      where: {
        status: { in: ['RECEIVED', 'FAILED'] },
        availableAt: { lte: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    for (const candidate of candidates) {
      try {
        const claimed = await this.prisma.whatsappInboundMessage.updateMany({
          where: { id: candidate.id, status: { in: ['RECEIVED', 'FAILED'] } },
          data: { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 } },
        });
        if (claimed.count === 1) {
          return this.prisma.whatsappInboundMessage.findUnique({ where: { id: candidate.id } });
        }
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
      }
    }
    return null;
  }

  private async processInbound(inbound: WhatsappInboundMessage): Promise<void> {
    try {
      if (this.needsProcessingNotice(inbound.payload)) {
        await this.sendProcessingNotice(inbound);
      }
      const result = await this.whatsappService.handleWebhook(
        inbound.payload as unknown as WhatsappWebhookDto,
        { deferDelivery: true, inboundMessageId: inbound.id },
      );
      const interactions = this.whatsappService.interactionsForReply(result.reply);
      await this.prisma.$transaction([
        this.prisma.whatsappOutboxMessage.create({
          data: {
            inboundMessageId: inbound.id,
            phone: result.phone,
            message: result.reply,
            ...(interactions.length
              ? { interactions: interactions as unknown as Prisma.InputJsonValue }
              : {}),
          },
        }),
        this.prisma.whatsappInboundMessage.update({
          where: { id: inbound.id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
            lockedAt: null,
            replyText: result.reply,
            lastError: null,
            payload: sanitizeWhatsappPayload(inbound.payload),
          },
        }),
      ]);
    } catch (error) {
      await this.failInbound(inbound, error);
    }
  }

  private async sendProcessingNotice(inbound: WhatsappInboundMessage): Promise<void> {
    try {
      const notice = await this.prisma.whatsappOutboxMessage.create({
        data: {
          id: inbound.id,
          phone: inbound.phone,
          message: '⏳ Estou analisando seu pedido. Já te respondo.',
          status: 'SENDING',
          attempts: 1,
          lockedAt: new Date(),
        },
      });
      await this.deliverOutbox(notice);
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
    }
  }

  private needsProcessingNotice(payload: Prisma.JsonValue): boolean {
    const record = this.asRecord(payload);
    if (record?.audio || record?.voice || record?.media || record?.image) return false;
    const data = this.asRecord(record?.data);
    const message = String(record?.text ?? record?.message ?? record?.body ?? data?.text ?? '').trim();
    if (message.length < 30) return false;
    const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return !/^(criar|adicione|adicionar|alterar|excluir|gastei|paguei|recebi|vendi)\b/.test(normalized);
  }

  private async failInbound(inbound: WhatsappInboundMessage, error: unknown): Promise<void> {
    const exhausted = inbound.attempts >= MAX_ATTEMPTS;
    await this.prisma.whatsappInboundMessage.update({
      where: { id: inbound.id },
      data: {
        status: exhausted ? 'DEAD_LETTER' : 'FAILED',
        lockedAt: null,
        lastError: this.errorMessage(error),
        availableAt: this.nextAttemptAt(inbound.attempts),
        ...(exhausted ? { payload: sanitizeWhatsappPayload(inbound.payload) } : {}),
      },
    });
    await this.updateActivityDelivery(
      { provider: inbound.provider, externalMessageId: inbound.externalMessageId },
      {
        sendStatus: exhausted ? 'DEAD_LETTER' : 'PROCESSING_FAILED',
        attempts: inbound.attempts,
        errorCode: exhausted ? 'PROCESSING_DEAD_LETTER' : 'PROCESSING_FAILED',
      },
    );
  }

  private async claimOutbox() {
    const candidate = await this.prisma.whatsappOutboxMessage.findFirst({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        availableAt: { lte: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return null;
    const claimed = await this.prisma.whatsappOutboxMessage.updateMany({
      where: { id: candidate.id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SENDING', lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.whatsappOutboxMessage.findUnique({ where: { id: candidate.id } });
  }

  private async deliverOutbox(outbox: WhatsappOutboxMessage): Promise<void> {
    try {
      const interactions = this.parseInteractions(outbox.interactions);
      const audio = interactions.length ? null : await this.preferredAudio(outbox.phone, outbox.message);
      const response = await this.providerClient.sendMessage({
        phone: outbox.phone,
        message: outbox.message,
        ...(interactions.length ? { interactions } : {}),
        ...(audio ? { ...audio, asVoice: true } : {}),
        idempotencyKey: outbox.id,
      });
      const providerMessageId = this.providerMessageId(response);
      if (!providerMessageId) {
        throw new Error('O provedor não confirmou o identificador da mensagem enviada.');
      }
      await this.prisma.whatsappOutboxMessage.update({
        where: { id: outbox.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          lockedAt: null,
          lastError: null,
          providerMessageId,
        },
      });
      await this.updateActivityDeliveryForOutbox(outbox, {
        sendStatus: 'SENT',
        attempts: outbox.attempts,
        errorCode: null,
      });
    } catch (error) {
      const exhausted = outbox.attempts >= MAX_ATTEMPTS;
      await this.prisma.whatsappOutboxMessage.update({
        where: { id: outbox.id },
        data: {
          status: exhausted ? 'DEAD_LETTER' : 'FAILED',
          lockedAt: null,
          deadLetteredAt: exhausted ? new Date() : null,
          lastError: this.errorMessage(error),
          availableAt: this.nextAttemptAt(outbox.attempts),
        },
      });
      await this.updateActivityDeliveryForOutbox(outbox, {
        sendStatus: exhausted ? 'DEAD_LETTER' : 'FAILED',
        attempts: outbox.attempts,
        errorCode: exhausted ? 'SEND_DEAD_LETTER' : 'SEND_FAILED',
      });
    }
  }

  private async recoverStaleLocks(): Promise<void> {
    const stale = new Date(Date.now() - STALE_LOCK_MS);
    await Promise.all([
      this.prisma.whatsappInboundMessage.updateMany({
        where: { status: 'PROCESSING', lockedAt: { lt: stale } },
        data: { status: 'FAILED', lockedAt: null, availableAt: new Date(), lastError: 'Lock expirado.' },
      }),
      this.prisma.whatsappOutboxMessage.updateMany({
        where: { status: 'SENDING', lockedAt: { lt: stale } },
        data: { status: 'FAILED', lockedAt: null, availableAt: new Date(), lastError: 'Lock expirado.' },
      }),
    ]);
  }

  private extractMessageId(payload: WhatsappWebhookDto): string {
    const data = this.asRecord(payload.data);
    const key = this.asRecord(data?.key);
    return String(payload.messageId ?? payload.id ?? data?.messageId ?? data?.id ?? key?.id ?? '')
      .trim()
      .slice(0, 200);
  }

  private extractPhone(payload: WhatsappWebhookDto): string {
    const data = this.asRecord(payload.data);
    return String(payload.phone ?? payload.number ?? payload.from ?? data?.phone ?? data?.number ?? data?.from ?? '')
      .replace(/\D/g, '');
  }

  private providerMessageId(response: unknown): string {
    const record = this.asRecord(response);
    const key = this.asRecord(record?.key);
    return String(record?.messageId ?? record?.id ?? key?.id ?? '').trim().slice(0, 200);
  }

  private deliveryStatus(current: WhatsappOutboxStatus, incoming: WhatsappDeliveryDto['status']): WhatsappOutboxStatus {
    const priority: Record<WhatsappOutboxStatus, number> = {
      PENDING: 0,
      SENDING: 1,
      SENT: 2,
      FAILED: 2,
      DELIVERED: 3,
      READ: 4,
      DEAD_LETTER: 5,
    };
    const next = incoming as WhatsappOutboxStatus;
    return priority[next] >= priority[current] ? next : current;
  }

  private nextAttemptAt(attempts: number): Date {
    const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + delayMs);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      Boolean(error && typeof error === 'object' && 'code' in error)
    ) && (error as { code?: string }).code === 'P2002';
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private parseInteractions(value: Prisma.JsonValue | null): Array<{ id: string; label: string; value: string }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const record = this.asRecord(item);
      const id = String(record?.id ?? '').trim();
      const label = String(record?.label ?? '').trim();
      const actionValue = String(record?.value ?? '').trim();
      return id && label && actionValue ? [{ id, label, value: actionValue }] : [];
    }).slice(0, 3);
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async updateActivityDeliveryForOutbox(
    outbox: WhatsappOutboxMessage,
    data: { sendStatus: string; attempts: number; errorCode: string | null },
  ): Promise<void> {
    if (!outbox.inboundMessageId) return;
    const inbound = await this.prisma.whatsappInboundMessage.findUnique({
      where: { id: outbox.inboundMessageId },
      select: { provider: true, externalMessageId: true },
    });
    await this.updateActivityDelivery(inbound, data);
  }

  private async preferredAudio(phone: string, message: string) {
    if (!this.speechService) return null;
    const normalized = phone.replace(/\D/g, '');
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ phone: normalized }, { phone: normalized.replace(/^55/, '') }] },
      select: { assistantPreference: { select: { audioRepliesEnabled: true } } },
    });
    return user?.assistantPreference?.audioRepliesEnabled
      ? this.speechService.synthesize(message)
      : null;
  }

  private async updateActivityDelivery(
    inbound: { provider: string; externalMessageId: string } | null | undefined,
    data: { sendStatus: string; attempts: number; errorCode?: string | null },
  ): Promise<void> {
    if (!inbound) return;
    const delegate = (this.prisma as unknown as {
      dinActivityEvent?: {
        updateMany: (input: unknown) => Promise<unknown>;
      };
    }).dinActivityEvent;
    if (!delegate) return;
    await delegate.updateMany({
      where: {
        provider: inbound.provider,
        externalMessageId: inbound.externalMessageId,
      },
      data: {
        sendStatus: data.sendStatus,
        attempts: data.attempts,
        ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
      },
    });
  }
}
