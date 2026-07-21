import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { WhatsappConversationMessage } from '@/services/ai/gemini.service';
import { AssistantSessionChannel } from './whatsapp-state-machine';

@Injectable()
export class WhatsappConversationStore {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string, phone: string, channel: AssistantSessionChannel = 'WHATSAPP') {
    const conversation = await this.prisma.whatsappConversation.upsert({
      where: { userId },
      create: { userId, phone, recentMessages: [] },
      update: { phone },
    });
    if (channel === 'WHATSAPP') return conversation;
    return {
      ...conversation,
      phone: `app-${userId}`,
      recentMessages: conversation.appRecentMessages ?? [],
      pendingText: conversation.appPendingText ?? null,
      pendingType: conversation.appPendingType ?? null,
      pendingStep: conversation.appPendingStep ?? null,
      pendingData: conversation.appPendingData ?? null,
      stateVersion: conversation.appStateVersion ?? 0,
    };
  }

  async claimTurn(
    userId: string,
    expectedVersion: number,
    channel: AssistantSessionChannel = 'WHATSAPP',
  ): Promise<boolean> {
    const delegate = this.prisma.whatsappConversation as unknown as {
      updateMany?: (
        args: Prisma.WhatsappConversationUpdateManyArgs,
      ) => Promise<{ count: number }>;
    };
    if (typeof delegate.updateMany !== 'function') return true;
    const result = await delegate.updateMany({
      where: channel === 'WHATSAPP'
        ? { userId, stateVersion: expectedVersion }
        : { userId, appStateVersion: expectedVersion },
      data: channel === 'WHATSAPP'
        ? { stateVersion: { increment: 1 } }
        : { appStateVersion: { increment: 1 } },
    });
    return !result || result.count === 1;
  }

  async setPending(input: {
    userId: string;
    phone: string;
    pendingText: string;
    pendingType: string;
    pendingStep: string;
    pendingData: Prisma.InputJsonValue;
    channel?: AssistantSessionChannel;
  }): Promise<void> {
    const channel = input.channel ?? 'WHATSAPP';
    await this.prisma.whatsappConversation.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        phone: input.phone,
        pendingText: input.pendingText,
        pendingType: input.pendingType,
        pendingStep: input.pendingStep,
        pendingData: input.pendingData,
        stateVersion: 1,
        recentMessages: [],
      },
      update: channel === 'WHATSAPP'
        ? {
            phone: input.phone,
            pendingText: input.pendingText,
            pendingType: input.pendingType,
            pendingStep: input.pendingStep,
            pendingData: input.pendingData,
            stateVersion: { increment: 1 },
          }
        : {
            appPendingText: input.pendingText,
            appPendingType: input.pendingType,
            appPendingStep: input.pendingStep,
            appPendingData: input.pendingData,
            appStateVersion: { increment: 1 },
          },
    });
  }

  async clearPending(userId: string, channel: AssistantSessionChannel = 'WHATSAPP'): Promise<void> {
    await this.prisma.whatsappConversation.update({
      where: { userId },
      data: channel === 'WHATSAPP'
        ? {
            pendingText: null,
            pendingType: null,
            pendingStep: null,
            pendingData: Prisma.JsonNull,
            stateVersion: { increment: 1 },
          }
        : {
            appPendingText: null,
            appPendingType: null,
            appPendingStep: null,
            appPendingData: Prisma.JsonNull,
            appStateVersion: { increment: 1 },
          },
    });
  }

  async append(input: {
    userId: string;
    phone: string;
    current: WhatsappConversationMessage[];
    userMessage: string;
    assistantMessage: string;
    channel?: AssistantSessionChannel;
  }): Promise<void> {
    const recentMessages = [
      ...input.current,
      { role: 'user' as const, text: input.userMessage },
      { role: 'assistant' as const, text: input.assistantMessage },
    ].slice(-10);
    const messagesJson = recentMessages as unknown as Prisma.InputJsonValue;

    const channel = input.channel ?? 'WHATSAPP';
    await this.prisma.whatsappConversation.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, phone: input.phone, recentMessages: messagesJson },
      update: channel === 'WHATSAPP'
        ? { phone: input.phone, recentMessages: messagesJson }
        : { appRecentMessages: messagesJson },
    });
  }
}
