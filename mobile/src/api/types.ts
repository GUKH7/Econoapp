export type TransactionType = 'INCOME' | 'EXPENSE';
export type TransactionSource = 'MANUAL' | 'TELEGRAM' | 'AUDIO';

export interface CategoryResponse {
  id: string;
  name: string;
  color: string;
  userId: string;
  createdAt: string;
}

export interface ChannelResponse {
  id: string;
  name: string;
  feePercent: number;
  isActive: boolean;
  userId: string;
  createdAt: string;
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
  date: string;
  userId: string;
  createdAt: string;
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

export interface ApiEnvelope<T> {
  data: T;
}

export interface PaginatedEnvelope<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface LoginPayload {
  email?: string;
  phone?: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  phone: string;
  email?: string;
  password: string;
}

export interface CreateTransactionPayload {
  description: string;
  amount: number;
  type: TransactionType;
  source?: TransactionSource;
  categoryId: string;
  channelId?: string;
  date?: string;
}

export interface CreateCategoryPayload {
  name: string;
  color?: string;
}
