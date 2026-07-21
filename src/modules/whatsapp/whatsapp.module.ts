import { Module } from '@nestjs/common';
import { TransactionModule } from '@/modules/transactions/transaction.module';
import { GeminiService } from '@/services/ai/gemini.service';
import { WhatsappBudgetAlertScheduler } from './whatsapp-budget-alert.scheduler';
import { WhatsappConversationStore } from './whatsapp-conversation.store';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappProviderClient } from './whatsapp-provider.client';
import { WhatsappScheduledNotificationService } from './whatsapp-scheduled-notification.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsappQueueService } from './whatsapp-queue.service';
import { WhatsappWebhookSecurityService } from './whatsapp-webhook-security.service';
import { WhatsappActionClassifierService } from './whatsapp-action-classifier.service';
import { WhatsappDataRetentionService } from './whatsapp-data-retention.service';
import { ProductIntelligenceModule } from '@/modules/product-intelligence/product-intelligence.module';
import { WhatsappSpeechService } from './whatsapp-speech.service';
import { WhatsappCollectionService } from './whatsapp-collection.service';

@Module({
  imports: [TransactionModule, ProductIntelligenceModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappProviderClient,
    WhatsappConversationStore,
    WhatsappScheduledNotificationService,
    WhatsappBudgetAlertScheduler,
    WhatsappQueueService,
    WhatsappWebhookSecurityService,
    WhatsappActionClassifierService,
    WhatsappDataRetentionService,
    WhatsappSpeechService,
    WhatsappCollectionService,
    GeminiService,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
