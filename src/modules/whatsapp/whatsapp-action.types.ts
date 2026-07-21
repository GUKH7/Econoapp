export const WHATSAPP_ACTIONS = [
  'CREATE_CATEGORY',
  'LIST_CATEGORIES',
  'UPDATE_CATEGORY',
  'DELETE_CATEGORY',
  'CREATE_TRANSACTION',
  'QUERY_EXPENSES',
  'SET_BUDGET',
  'CREATE_ACCOUNT',
  'CREATE_RECEIVABLE',
  'CREATE_PAYABLE',
] as const;

export type WhatsappAction = (typeof WHATSAPP_ACTIONS)[number];

export type WhatsappActionEntities = {
  categoryName?: string | undefined;
  currentCategoryName?: string | undefined;
  newCategoryName?: string | undefined;
  accountName?: string | undefined;
  counterparty?: string | undefined;
  description?: string | undefined;
  amount?: number | undefined;
  dueDate?: string | undefined;
};

export type WhatsappActionClassification = {
  action: WhatsappAction | 'HELP' | 'GENERAL_CONVERSATION' | 'UNKNOWN';
  confidence: number;
  entities: WhatsappActionEntities;
  source: 'RULE' | 'AI' | 'HYBRID';
  ambiguity?: 'CATEGORY_CREATE_OR_QUERY';
};

export type WhatsappPendingAction =
  | { action: 'CREATE_CATEGORY' }
  | { action: 'UPDATE_CATEGORY'; currentCategoryName?: string }
  | { action: 'DELETE_CATEGORY'; categoryName: string; awaitingConfirmation: true }
  | { action: 'DISAMBIGUATE_CATEGORY'; categoryName: string }
  | {
      action: 'CREATE_RECEIVABLE' | 'CREATE_PAYABLE';
      message: string;
      entities: WhatsappActionEntities;
    };
