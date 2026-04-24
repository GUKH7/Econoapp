import { TelegramInlineKeyboardMarkup } from './main.keyboard';

export type ReportPeriod = 'this_month' | 'previous_month' | 'last_7_days' | 'custom';

export function createPeriodKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'Este mês', callback_data: 'period:this_month' },
        { text: 'Mês anterior', callback_data: 'period:previous_month' },
      ],
      [
        { text: 'Últimos 7 dias', callback_data: 'period:last_7_days' },
        { text: 'Personalizado', callback_data: 'period:custom' },
      ],
    ],
  };
}
