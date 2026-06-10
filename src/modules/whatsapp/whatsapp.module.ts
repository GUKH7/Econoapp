import { Module } from '@nestjs/common';
import { TransactionModule } from '@/modules/transactions/transaction.module';
import { GeminiService } from '@/services/ai/gemini.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [TransactionModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, GeminiService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
