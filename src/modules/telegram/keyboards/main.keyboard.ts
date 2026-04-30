export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramKeyboardButton {
  text: string;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramKeyboardButton[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
}

export function createMainKeyboard(): TelegramReplyKeyboardMarkup {
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
