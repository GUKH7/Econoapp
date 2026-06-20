import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { WhatsappConversationMessage } from '@/services/ai/gemini.service';

@Injectable()
export class WhatsappConversationStore {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get(userId: string, phone: string) {
    return this.prisma.whatsappConversation.upsert({
      where: { userId },
      create: { userId, phone, recentMessages: [] },
      update: { phone },
    });
  }

  async setPending(input: {
    userId: string;
    phone: string;
    pendingText: string;
    pendingType: string;
    pendingStep: string;
    pendingData: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.whatsappConversation.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        phone: input.phone,
        pendingText: input.pendingText,
        pendingType: input.pendingType,
        pendingStep: input.pendingStep,
        pendingData: input.pendingData,
        recentMessages: [],
      },
      update: {
        phone: input.phone,
        pendingText: input.pendingText,
        pendingType: input.pendingType,
        pendingStep: input.pendingStep,
        pendingData: input.pendingData,
      },
    });
  }

  async clearPending(userId: string): Promise<void> {
    await this.prisma.whatsappConversation.update({
      where: { userId },
      data: {
        pendingText: null,
        pendingType: null,
        pendingStep: null,
        pendingData: Prisma.JsonNull,
      },
    });
  }

  async append(input: {
    userId: string;
    phone: string;
    current: WhatsappConversationMessage[];
    userMessage: string;
    assistantMessage: string;
  }): Promise<void> {
    const recentMessages = [
      ...input.current,
      { role: 'user' as const, text: input.userMessage },
      { role: 'assistant' as const, text: input.assistantMessage },
    ].slice(-10);
    const messagesJson = recentMessages as unknown as Prisma.InputJsonValue;

    await this.prisma.whatsappConversation.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, phone: input.phone, recentMessages: messagesJson },
      update: { phone: input.phone, recentMessages: messagesJson },
    });
  }
}

