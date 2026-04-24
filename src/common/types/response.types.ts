import { TransactionType, TransactionSource } from '@prisma/client';

export interface CategoryResponse {
  id: string;
  name: string;
  color: string;
  userId: string;
  createdAt: Date;
}

export interface ChannelResponse {
  id: string;
  name: string;
  feePercent: number;
  isActive: boolean;
  userId: string;
  createdAt: Date;
}

export interface TransactionResponse {
  id: string;
  description: string;
  amount: number;
  netAmount: number;
  type: TransactionType;
  source: TransactionSource;
  categoryId: string;
  channelId: string | null;
  date: Date;
  userId: string;
  createdAt: Date;
  whatsappMessageId: string | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserResponse {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
}

export interface DashboardSummaryResponse {
  balance: number;
  totalIncome: number;
  totalExpense: number;
  byCategory: Array<{
    categoryName: string;
    color: string;
    total: number;
    percentage: number;
  }>;
  byChannel: Array<{
    channelName: string;
    total: number;
    netTotal: number;
    transactionCount: number;
  }>;
  cashFlow: Array<{
    date: string;
    income: number;
    expense: number;
  }>;
}
