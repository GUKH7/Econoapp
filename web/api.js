import { clearSession, saveSession, state } from './state.js';

let refreshPromise = null;

async function refreshSession() {
  if (!state.refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = fetch(`${state.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const payload = await response.json();
        if (!payload?.data?.accessToken || !payload?.data?.refreshToken) return false;
        saveSession(payload.data);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request(path, options = {}, retrying = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 75000);
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);

  try {
    const response = await fetch(`${state.apiUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (response.status === 401 && !retrying && !path.startsWith('/auth/')) {
      clearTimeout(timeout);
      const refreshed = await refreshSession();
      if (refreshed) return request(path, options, true);
      clearSession();
      throw new Error('Sua sessão expirou. Entre novamente para continuar.');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message = body?.message || body?.error || `Erro ${response.status}`;
      throw new Error(Array.isArray(message) ? message.join('\n') : message);
    }

    if (response.status === 204) return null;
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('O servidor demorou para iniciar. Tente novamente em alguns segundos.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function api() {
  return {
    login: (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
    googleLogin: (payload) => request('/auth/google', { method: 'POST', body: JSON.stringify(payload) }),
    register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
    me: () => request('/auth/me'),
    dashboard: () => request(`/dashboard?scope=${state.scope}`),
    transactions: () => request(`/transactions?limit=100&scope=${state.scope}`),
    categories: () => request('/categories'),
    channels: () => request('/channels'),
    accounts: () => request('/accounts'),
    cards: () => request('/accounts/cards'),
    budgets: () => request(`/budgets?scope=${state.scope}`),
    upsertBudget: (payload) =>
      request('/budgets', { method: 'POST', body: JSON.stringify(payload) }),
    deleteBudget: (id) => request(`/budgets/${id}`, { method: 'DELETE' }),
    createTransaction: (payload) =>
      request('/transactions', { method: 'POST', body: JSON.stringify(payload) }),
    createCategory: (payload) =>
      request('/categories', { method: 'POST', body: JSON.stringify(payload) }),
    createChannel: (payload) =>
      request('/channels', { method: 'POST', body: JSON.stringify(payload) }),
    createAccount: (payload) =>
      request('/accounts', { method: 'POST', body: JSON.stringify(payload) }),
    deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
    createCard: (payload) =>
      request('/accounts/cards', { method: 'POST', body: JSON.stringify(payload) }),
    assistantMessage: (payload) =>
      request('/assistant/message', { method: 'POST', body: JSON.stringify(payload) }),
    whatsappStatus: () => request('/whatsapp/status'),
    whatsappRestart: () => request('/whatsapp/restart'),
    sendWhatsappMessage: (payload) =>
      request('/whatsapp/send-message', { method: 'POST', body: JSON.stringify(payload) }),
  };
}

export async function loadData() {
  const client = api();
  const [me, dashboard, transactions, categories, channels, accounts, cards, budgets] = await Promise.all([
    client.me(),
    client.dashboard(),
    client.transactions(),
    client.categories(),
    client.channels(),
    client.accounts(),
    client.cards(),
    client.budgets(),
  ]);
  state.user = me.data;
  state.dashboard = dashboard.data;
  state.transactions = transactions.data;
  state.categories = categories.data;
  state.channels = channels.data;
  state.wallets = accounts.data;
  state.cards = cards.data;
  state.budgetSummary = budgets.data;
  state.categoryBudgets = budgets.data.items || [];
  state.budgets[state.scope] = Number(budgets.data.totalLimit || 0);
  localStorage.removeItem('econoapp.budgets');
}
