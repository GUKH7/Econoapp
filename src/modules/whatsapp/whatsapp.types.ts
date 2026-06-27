import { FinancialAccountType, FinancialScope, TransactionType } from '@prisma/client';

export type WhatsappStatus = 'aguardando_qr' | 'conectado' | 'iniciando' | 'reconectando';

export type FinancialPeriod = {
  start: Date;
  end: Date;
  label: string;
};

export type WhatsappTransactionDraft = {
  description: string;
  amount: number;
  totalAmount?: number;
  installmentCount?: number;
  transactionDate?: string;
  type: TransactionType;
  scope: FinancialScope;
  categoryHint: string;
  channelHint?: string;
  accountId?: string;
  creditCardId?: string;
  paymentLabel?: string;
  lowConfidence?: boolean;
  possibleDuplicate?: {
    description: string;
    amount: number;
    date: string;
  };
};

export type WhatsappPaymentOption = {
  id: string;
  kind: 'ACCOUNT' | 'CARD';
  name: string;
  label: string;
  accountType?: 'BANK' | 'WALLET';
};

export type WhatsappPaymentDraft = {
  transaction: WhatsappTransactionDraft;
  options: WhatsappPaymentOption[];
  createPayment?: {
    waitingForName?: boolean;
    type: FinancialAccountType;
  };
};

export type WhatsappCategoryDraft = {
  transaction: WhatsappTransactionDraft;
  options: string[];
};

export type WhatsappDraftEdit =
  | { kind: 'amount'; amount: number; label: string }
  | { kind: 'title'; title: string; label: string }
  | { kind: 'category'; category: string; label: string }
  | { kind: 'scope'; scope: FinancialScope; label: string }
  | { kind: 'payment'; query?: string; label: string };

export type WhatsappMutationDraft =
  | {
      action: 'UPDATE_AMOUNT';
      transactionId: string;
      description: string;
      previousAmount: number;
      newAmount: number;
      type: TransactionType;
    }
  | {
      action: 'DELETE';
      transactionId: string;
      description: string;
      amount: number;
      type: TransactionType;
    }
  | {
      action: 'DELETE_ACCOUNT';
      accountId: string;
      accountName: string;
      accountType: FinancialAccountType;
      balance: number;
      scope: FinancialScope;
    };

export type WhatsappConversationState = {
  pendingText?: string | null;
  pendingType?: string | null;
  pendingStep?: string | null;
  pendingData?: unknown;
};

export interface WhatsappStatusResponse {
  status: WhatsappStatus;
  qrcode?: string;
}
