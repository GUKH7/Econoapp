export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export function createMainKeyboard(): any {
  return {
    keyboard: [
      [{ text: '📊 Ver Resumo' }, { text: '💰 Ver Saldo' }],
      [{ text: '📋 Últimas 5 transações' }, { text: '🏪 Canais' }],
      [{ text: '❓ Ajuda' }, { text: '⚙️ Configurações' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}
