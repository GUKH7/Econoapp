import { Module } from '@nestjs/common';
import { TransactionRepository } from '@/modules/transactions/repositories/transaction.repository';
import { GeminiService } from '@/services/ai/gemini.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppService, GeminiService, TransactionRepository],
})
export class WhatsAppModule {}
