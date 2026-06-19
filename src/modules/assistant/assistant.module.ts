import { Module } from '@nestjs/common';
import { WhatsappModule } from '@/modules/whatsapp/whatsapp.module';
import { AssistantController } from './assistant.controller';

@Module({
  imports: [WhatsappModule],
  controllers: [AssistantController],
})
export class AssistantModule {}
