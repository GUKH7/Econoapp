import { Module } from '@nestjs/common';
import { TransactionModule } from '@/modules/transactions/transaction.module';
import { GeminiService } from '@/services/ai/gemini.service';
import { WhatsappBudgetAlertScheduler } from './whatsapp-budget-alert.scheduler';
import { WhatsappConversationStore } from './whatsapp-conversation.store';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappProviderClient } from './whatsapp-provider.client';
import { WhatsappScheduledNotificationService } from './whatsapp-scheduled-notification.service';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [TransactionModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappProviderClient,
    WhatsappConversationStore,
    WhatsappScheduledNotificationService,
    WhatsappBudgetAlertScheduler,
    GeminiService,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
