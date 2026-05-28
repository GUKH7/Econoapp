import type {
  ApiEnvelope,
  AuthTokensResponse,
  CategoryResponse,
  ChannelResponse,
  CreateCategoryPayload,
  CreateTransactionPayload,
  DashboardSummaryResponse,
  LoginPayload,
  PaginatedEnvelope,
  RegisterPayload,
  TransactionResponse,
  UserResponse,
} from './types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
const REQUEST_TIMEOUT_MS = 12000;

let accessToken: string | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(
        'A API demorou para responder. Confira se o backend esta rodando e se o IP do Expo esta correto.',
        0,
      );
    }

    throw new ApiError(
      'Nao foi possivel conectar na API. Confira o backend, o IP local e a rede Wi-Fi.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body?.message ??
      body?.error ??
      `A API respondeu com status ${response.status}.`;
    throw new ApiError(Array.isArray(message) ? message.join('\n') : message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  login(payload: LoginPayload) {
    return request<ApiEnvelope<AuthTokensResponse>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  register(payload: RegisterPayload) {
    return request<ApiEnvelope<AuthTokensResponse>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  me() {
    return request<ApiEnvelope<UserResponse>>('/auth/me');
  },
  dashboard() {
    return request<ApiEnvelope<DashboardSummaryResponse>>('/dashboard');
  },
  listTransactions(params: { page?: number; limit?: number } = {}) {
    const search = new URLSearchParams();
    if (params.page) search.set('page', String(params.page));
    if (params.limit) search.set('limit', String(params.limit));
    const query = search.toString();
    return request<PaginatedEnvelope<TransactionResponse>>(
      `/transactions${query ? `?${query}` : ''}`,
    );
  },
  createTransaction(payload: CreateTransactionPayload) {
    return request<ApiEnvelope<TransactionResponse>>('/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  listCategories() {
    return request<ApiEnvelope<CategoryResponse[]>>('/categories');
  },
  createCategory(payload: CreateCategoryPayload) {
    return request<ApiEnvelope<CategoryResponse>>('/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  listChannels() {
    return request<ApiEnvelope<ChannelResponse[]>>('/channels');
  },
};
