import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/database';

const DAY_MS = 24 * 60 * 60 * 1_000;
const CONTENT_RETENTION_DAYS = 30;
const CONVERSATION_RETENTION_DAYS = 90;
const METADATA_RETENTION_DAYS = 180;

export interface WhatsappRetentionResult {
  redactedEvents: number;
  deletedEvents: number;
  deletedInbound: number;
  deletedOutbox: number;
  clearedConversations: number;
  deletedInsights: number;
}

@Injectable()
export class WhatsappDataRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappDataRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.runSafely(), DAY_MS);
    this.timer.unref();
    void this.runSafely();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<WhatsappRetentionResult> {
    const contentCutoff = new Date(now.getTime() - CONTENT_RETENTION_DAYS * DAY_MS);
    const conversationCutoff = new Date(now.getTime() - CONVERSATION_RETENTION_DAYS * DAY_MS);
    const metadataCutoff = new Date(now.getTime() - METADATA_RETENTION_DAYS * DAY_MS);

    const redacted = await this.prisma.dinActivityEvent.updateMany({
      where: { redactedAt: null, retentionUntil: { lte: now } },
      data: {
        phone: null,
        messageText: null,
        audioTranscription: null,
        replyText: null,
        errorMessage: null,
        payload: Prisma.JsonNull,
        redactedAt: now,
      },
    });
    const deletedEvents = await this.prisma.dinActivityEvent.deleteMany({
      where: { createdAt: { lt: metadataCutoff } },
    });
    const deletedInbound = await this.prisma.whatsappInboundMessage.deleteMany({
      where: { createdAt: { lt: contentCutoff } },
    });
    const deletedOutbox = await this.prisma.whatsappOutboxMessage.deleteMany({
      where: { createdAt: { lt: contentCutoff } },
    });
    const clearedConversations = await this.prisma.whatsappConversation.updateMany({
      where: { updatedAt: { lt: conversationCutoff } },
      data: {
        recentMessages: [],
        pendingText: null,
        pendingType: null,
        pendingStep: null,
        pendingData: Prisma.JsonNull,
        stateVersion: { increment: 1 },
        appRecentMessages: [],
        appPendingText: null,
        appPendingType: null,
        appPendingStep: null,
        appPendingData: Prisma.JsonNull,
        appStateVersion: { increment: 1 },
      },
    });
    const deletedInsights = await this.prisma.dinInsight.deleteMany({
      where: {
        updatedAt: { lt: metadataCutoff },
        status: { in: ['ACTED', 'DISMISSED', 'EXPIRED'] },
      },
    });

    return {
      redactedEvents: redacted.count,
      deletedEvents: deletedEvents.count,
      deletedInbound: deletedInbound.count,
      deletedOutbox: deletedOutbox.count,
      clearedConversations: clearedConversations.count,
      deletedInsights: deletedInsights.count,
    };
  }

  private async runSafely(): Promise<void> {
    try {
      const result = await this.run();
      this.logger.log(`Retencao WhatsApp concluida: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error('Falha ao aplicar retencao do WhatsApp.', error instanceof Error ? error.stack : String(error));
    }
  }
}
