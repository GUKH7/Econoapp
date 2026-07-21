import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { env } from '@/config/env';
import { WhatsappScheduledNotificationService } from './whatsapp-scheduled-notification.service';
import { WhatsappService } from './whatsapp.service';
import { ProductIntelligenceService } from '@/modules/product-intelligence/product-intelligence.service';
import { WhatsappQueueService } from './whatsapp-queue.service';

@Injectable()
export class WhatsappBudgetAlertScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappBudgetAlertScheduler.name);
  private initialTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;

  constructor(
    @Inject(WhatsappService) private readonly whatsappService: WhatsappService,
    @Inject(WhatsappScheduledNotificationService)
    private readonly scheduledNotificationService: WhatsappScheduledNotificationService,
    @Inject(ProductIntelligenceService)
    private readonly productIntelligence: ProductIntelligenceService,
    @Inject(WhatsappQueueService)
    private readonly whatsappQueue: WhatsappQueueService,
  ) {}

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
      const [budgetResult, scheduledResult] = await Promise.all([
        this.whatsappService.runProactiveBudgetAlerts(),
        this.scheduledNotificationService.run(),
      ]);

      if (budgetResult.sent || budgetResult.failed) {
        this.logger.log(
          `Alertas de orçamento: ${budgetResult.sent} enviados, ${budgetResult.failed} falharam, ${budgetResult.skipped} ignorados.`,
        );
      }

      if (scheduledResult.sent || scheduledResult.failed) {
        this.logger.log(
          `Lembretes agendados: ${scheduledResult.sent} enviados, ${scheduledResult.failed} falharam, ${scheduledResult.skipped} ignorados.`,
        );
      }

      await this.productIntelligence.refreshActiveUsers();
      const insights = await this.productIntelligence.deliverable();
      for (const insight of insights) {
        await this.whatsappQueue.enqueueOutbound({
          phone: insight.phone,
          message: insight.message,
          interactions: [
            { id: 'create-budget', label: 'Criar orçamento', value: `insight:${insight.insightId}:CREATE_BUDGET` },
            { id: 'remind', label: 'Lembrar depois', value: `insight:${insight.insightId}:REMIND_LATER` },
            { id: 'ignore', label: 'Ignorar', value: `insight:${insight.insightId}:IGNORE` },
          ],
        });
        await this.productIntelligence.markNotified(insight.insightId);
      }
    } catch (error) {
      this.logger.error(
        'Falha ao executar notificações financeiras agendadas.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
