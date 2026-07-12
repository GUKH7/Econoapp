import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { env } from '@/config/env';
import { RecurringTransactionService } from './recurring-transaction.service';

@Injectable()
export class RecurringTransactionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringTransactionScheduler.name);
  private initialTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;

  constructor(
    @Inject(RecurringTransactionService)
    private readonly recurringTransactionService: RecurringTransactionService,
  ) {}

  onModuleInit(): void {
    if (env.NODE_ENV === 'test') return;
    const intervalMs = env.RECURRING_TRANSACTION_INTERVAL_MINUTES * 60_000;
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
      const result = await this.recurringTransactionService.generateAllDue();
      if (result.created) {
        this.logger.log(
          `Recorrências automáticas: ${result.created} transações geradas para ${result.usersChecked} usuários.`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Falha ao gerar transações recorrentes automaticamente.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
