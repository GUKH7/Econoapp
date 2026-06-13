import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { env } from '@/config/env';
import { WhatsappService } from './whatsapp.service';

@Injectable()
export class WhatsappBudgetAlertScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappBudgetAlertScheduler.name);
  private initialTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;

  constructor(@Inject(WhatsappService) private readonly whatsappService: WhatsappService) {}

  onModuleInit(): void {
    if (env.NODE_ENV === 'test') return;
    const intervalMs = env.WHATSAPP_BUDGET_ALERT_INTERVAL_MINUTES * 60_000;
    this.initialTimer = setTimeout(() => void this.run(), 30_000);
    this.intervalTimer = setInterval(() => void this.run(), intervalMs);
    this.initialTimer.unref();
    this.intervalTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
  }

  private async run(): Promise<void> {
    try {
      const result = await this.whatsappService.runProactiveBudgetAlerts();
      if (result.sent || result.failed) {
        this.logger.log(
          `Alertas de orçamento: ${result.sent} enviados, ${result.failed} falharam, ${result.skipped} ignorados.`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Falha ao verificar alertas proativos de orçamento.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
