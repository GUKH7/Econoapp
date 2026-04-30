import { Injectable, Logger } from '@nestjs/common';
import { Transaction } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

@Injectable()
export class TelegramNotificationService {
  private readonly logger = new Logger(TelegramNotificationService.name);

  constructor(@InjectBot() private readonly bot: Telegraf) {}

  async sendTransactionConfirmation(telegramId: string, transaction: Transaction): Promise<void> {
    const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      Number(transaction.amount),
    );

    await this.safeSend(
      telegramId,
      [
        '✅ Transação registrada com sucesso!',
        `📝 ${transaction.description}`,
        `💰 Valor: ${amount}`,
      ].join('\n'),
    );
  }

  async sendDailyDigest(telegramId: string): Promise<void> {
    await this.safeSend(
      telegramId,
      '📅 Resumo diário: em breve você receberá automaticamente um panorama das movimentações do dia.',
    );
  }

  async sendGoalAlert(telegramId: string, message: string): Promise<void> {
    await this.safeSend(telegramId, `🚨 Alerta de meta\n${message}`);
  }

  async sendWeeklyReport(telegramId: string): Promise<void> {
    await this.safeSend(
      telegramId,
      '📈 Relatório semanal: em breve você verá os totais por categoria automaticamente.',
    );
  }

  private async safeSend(telegramId: string, text: string): Promise<void> {
    const chatId = Number(telegramId);
    if (Number.isNaN(chatId)) {
      this.logger.warn(`telegramId inválido para envio: ${telegramId}`);
      return;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, text);
    } catch (error) {
      this.logger.error(`Falha ao enviar notificação para telegramId=${telegramId}: ${String(error)}`);
    }
  }
}
