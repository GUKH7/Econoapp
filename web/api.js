import { state } from './state.js';

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);

  try {
    const response = await fetch(`${state.apiUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message = body?.message || body?.error || `Erro ${response.status}`;
      throw new Error(Array.isArray(message) ? message.join('\n') : message);
    }

    if (response.status === 204) return null;
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('A API demorou para responder. Confira o backend e a URL configurada.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function api() {
  return {
    login: (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
    register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
    me: () => request('/auth/me'),
    dashboard: () => request(`/dashboard?scope=${state.scope}`),
    transactions: () => request(`/transactions?limit=100&scope=${state.scope}`),
    categories: () => request('/categories'),
    channels: () => request('/channels'),
    accounts: () => request('/accounts'),
    cards: () => request('/accounts/cards'),
    createTransaction: (payload) =>
      request('/transactions', { method: 'POST', body: JSON.stringify(payload) }),
    createCategory: (payload) =>
      request('/categories', { method: 'POST', body: JSON.stringify(payload) }),
    createChannel: (payload) =>
      request('/channels', { method: 'POST', body: JSON.stringify(payload) }),
    createAccount: (payload) =>
      request('/accounts', { method: 'POST', body: JSON.stringify(payload) }),
    createCard: (payload) =>
      request('/accounts/cards', { method: 'POST', body: JSON.stringify(payload) }),
  };
}

export async function loadData() {
  const client = api();
  const [me, dashboard, transactions, categories, channels, accounts, cards] = await Promise.all([
    client.me(),
    client.dashboard(),
    client.transactions(),
    client.categories(),
    client.channels(),
    client.accounts(),
    client.cards(),
  ]);
  state.user = me.data;
  state.dashboard = dashboard.data;
  state.transactions = transactions.data;
  state.categories = categories.data;
  state.channels = channels.data;
  state.wallets = accounts.data;
  state.cards = cards.data;
}
