import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import { env } from '@/config/env';
import { ChannelModule } from '@/modules/channels/channel.module';
import { DashboardModule } from '@/modules/dashboard/dashboard.module';
import { TransactionModule } from '@/modules/transactions/transaction.module';
import { GeminiService } from '@/services/ai/gemini.service';
import { EditProfileScene } from './telegram.scenes/edit-profile.scene';
import { OnboardingScene } from './telegram.scenes/onboarding.scene';
import { TelegramNotificationService } from './telegram-notification.service';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';

const isTelegramEnabled = /^\d+:[\w-]+$/.test(env.TELEGRAM_BOT_TOKEN);

@Module({
  imports: [
    ...(isTelegramEnabled
      ? [
          TelegrafModule.forRoot({
            token: env.TELEGRAM_BOT_TOKEN,
            middlewares: [session()],
            launchOptions: {
              dropPendingUpdates: true,
            },
          }),
        ]
      : []),
    TransactionModule,
    DashboardModule,
    ChannelModule,
  ],
  providers: [
    TelegramUpdate,
    TelegramService,
    TelegramNotificationService,
    GeminiService,
    OnboardingScene,
    EditProfileScene,
  ],
  exports: [TelegramService, TelegramNotificationService],
})
export class TelegramModule implements OnModuleInit {
  private readonly logger = new Logger(TelegramModule.name);

  async onModuleInit(): Promise<void> {
    if (!isTelegramEnabled) {
      this.logger.warn('Telegram desativado: TELEGRAM_BOT_TOKEN não configurado.');
      return;
    }

    try {
      // Remove qualquer webhook anterior para garantir que o polling funcione
      const res = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`,
      );
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        this.logger.log('Telegram: webhook removido, iniciando polling.');
      }
    } catch (error) {
      this.logger.warn(
        { error },
        'Telegram indisponivel no boot; a API continuara rodando sem remover webhook.',
      );
    }
  }
}
