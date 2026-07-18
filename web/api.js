import { clearSession, saveSession, state } from './state.js';

let refreshPromise = null;

const authRoutesWithoutRefresh = new Set([
  '/auth/login',
  '/auth/google',
  '/auth/register',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

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

    if (response.status === 401 && !retrying && !authRoutesWithoutRefresh.has(path)) {
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

    if (options.raw) return response;
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
    forgotPassword: (payload) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(payload) }),
    resetPassword: (payload) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) }),
    me: () => request('/auth/me'),
    exportAccount: () => request('/auth/me/export'),
    deleteUserAccount: (payload) => request('/auth/me', { method: 'DELETE', body: JSON.stringify(payload) }),
    dashboard: () => request(`/dashboard?scope=${state.scope}`),
    report: (offset = state.reportPeriodOffset) => {
      const { startDate, endDate } = monthPeriod(offset);
      return request(`/dashboard/reports?startDate=${startDate}&endDate=${endDate}&scope=${state.scope}`);
    },
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
    importTransactionsCsv: (payload) =>
      request('/transactions/import/csv', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 120000 }),
    exportTransactionsCsv: () =>
      request(`/transactions/export/csv?scope=${state.scope}`, { method: 'GET', raw: true, timeoutMs: 120000 }),
    recurringTransactions: () => request(`/transactions/recurring?scope=${state.scope}`),
    businessSummary: () => request('/business/summary'),
    businessSettings: () => request('/business/settings'),
    completeBusinessOnboarding: (payload) => request('/business/onboarding', { method: 'POST', body: JSON.stringify(payload) }),
    businessEntries: () => request('/business/entries'),
    businessContacts: () => request('/business/contacts'),
    createBusinessContact: (payload) =>
      request('/business/contacts', { method: 'POST', body: JSON.stringify(payload) }),
    updateBusinessContact: (id, payload) =>
      request(`/business/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    deleteBusinessContact: (id) => request(`/business/contacts/${id}`, { method: 'DELETE' }),
    businessOfferings: () => request('/business/offerings'),
    productReport: () => request('/business/product-report'),
    businessReport: (offset = state.reportPeriodOffset) => {
      const { startDate, endDate } = monthPeriod(offset);
      return request(`/business/reports?startDate=${startDate}&endDate=${endDate}`);
    },
    exportBusinessReport: (format, offset = state.reportPeriodOffset) => {
      const { startDate, endDate } = monthPeriod(offset);
      return request(`/business/reports/export/${format}?startDate=${startDate}&endDate=${endDate}`, { method: 'GET', raw: true, timeoutMs: 120000 });
    },
    createBusinessOffering: (payload) => request('/business/offerings', { method: 'POST', body: JSON.stringify(payload) }),
    updateBusinessOffering: (id, payload) => request(`/business/offerings/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    deleteBusinessOffering: (id) => request(`/business/offerings/${id}`, { method: 'DELETE' }),
    createBusinessEntry: (payload) =>
      request('/business/entries', { method: 'POST', body: JSON.stringify(payload) }),
    settleBusinessEntry: (id, payload = {}) =>
      request(`/business/entries/${id}/settle`, { method: 'POST', body: JSON.stringify(payload) }),
    cancelBusinessEntry: (id) => request(`/business/entries/${id}`, { method: 'DELETE' }),
    updateBusinessSettings: (payload) =>
      request('/business/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
    createRecurringTransaction: (payload) =>
      request('/transactions/recurring', { method: 'POST', body: JSON.stringify(payload) }),
    updateRecurringTransaction: (id, payload) =>
      request(`/transactions/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    generateRecurringTransactions: (payload = {}) =>
      request('/transactions/recurring/generate', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 120000 }),
    deactivateRecurringTransaction: (id) => request(`/transactions/recurring/${id}`, { method: 'DELETE' }),
    createCategory: (payload) =>
      request('/categories', { method: 'POST', body: JSON.stringify(payload) }),
    updateCategory: (id, payload) =>
      request(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    createChannel: (payload) =>
      request('/channels', { method: 'POST', body: JSON.stringify(payload) }),
    createAccount: (payload) =>
      request('/accounts', { method: 'POST', body: JSON.stringify(payload) }),
    deleteFinancialAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
    createCard: (payload) =>
      request('/accounts/cards', { method: 'POST', body: JSON.stringify(payload) }),
    assistantMessage: (payload) =>
      request('/assistant/message', { method: 'POST', body: JSON.stringify(payload) }),
    assistantActivity: () => request('/assistant/activity'),
    whatsappStatus: () => request('/whatsapp/status'),
    whatsappRestart: () => request('/whatsapp/restart'),
    sendWhatsappMessage: (payload) =>
      request('/whatsapp/send-message', { method: 'POST', body: JSON.stringify(payload) }),
  };
}

export async function loadData() {
  const client = api();
  const me = await client.me();
  state.user = me.data;
  const accessExpired = Boolean(state.user?.paidUntil && new Date(state.user.paidUntil) < new Date());
  if ((state.user?.accessStatus && state.user.accessStatus !== 'ACTIVE') || accessExpired) {
    state.loadWarnings = [];
    return { warnings: [] };
  }

  const resources = [
    ['dashboard', client.dashboard()],
    ['report', client.report()],
    ['transactions', client.transactions()],
    ['categories', client.categories()],
    ['channels', client.channels()],
    ['accounts', client.accounts()],
    ['cards', client.cards()],
    ['budgets', client.budgets()],
    ['recurring', client.recurringTransactions()],
    ['assistant', client.assistantActivity()],
    ...(state.scope === 'BUSINESS'
      ? [['businessSummary', client.businessSummary()], ['businessSettings', client.businessSettings()], ['businessEntries', client.businessEntries()], ['businessContacts', client.businessContacts()], ['businessOfferings', client.businessOfferings()], ['productReport', client.productReport()], ['businessReport', client.businessReport()]]
      : []),
  ];
  const results = await Promise.allSettled(resources.map(([, promise]) => promise));
  const loaded = {};
  state.loadWarnings = [];
  results.forEach((result, index) => {
    const name = resources[index][0];
    if (result.status === 'fulfilled') loaded[name] = result.value.data;
    else state.loadWarnings.push(name);
  });

  if ('dashboard' in loaded) state.dashboard = loaded.dashboard;
  if ('report' in loaded) state.report = loaded.report;
  if ('transactions' in loaded) state.transactions = loaded.transactions || [];
  if ('categories' in loaded) state.categories = loaded.categories || [];
  if ('channels' in loaded) state.channels = loaded.channels || [];
  if ('accounts' in loaded) state.wallets = loaded.accounts || [];
  if ('cards' in loaded) state.cards = loaded.cards || [];
  if ('budgets' in loaded) {
    state.budgetSummary = loaded.budgets;
    state.categoryBudgets = loaded.budgets?.items || [];
    state.budgets[state.scope] = Number(loaded.budgets?.totalLimit || 0);
  }
  if ('recurring' in loaded) state.recurringTransactions = loaded.recurring || [];
  if ('assistant' in loaded) {
    state.assistantActivity = loaded.assistant;
    state.assistantMessages = loaded.assistant?.messages || [];
  }
  if ('businessSummary' in loaded) state.businessSummary = loaded.businessSummary;
  if ('businessSettings' in loaded) {
    state.businessSettings = loaded.businessSettings;
    if (state.scope === 'BUSINESS' && !loaded.businessSettings?.onboardingCompleted && !state.businessOnboardingOpen) {
      state.businessOnboardingDraft = {
        businessType: loaded.businessSettings?.businessType || '',
        salesChannels: loaded.businessSettings?.salesChannels || [],
        recurringExpenses: loaded.businessSettings?.recurringExpenses || [],
        receivingMethods: loaded.businessSettings?.receivingMethods || [],
        revenueGoal: loaded.businessSettings?.revenueGoal ? Number(loaded.businessSettings.revenueGoal).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
        reserveTaxes: Number(loaded.businessSettings?.taxRate || 0) > 0,
        taxRate: Number(loaded.businessSettings?.taxRate || 6).toLocaleString('pt-BR'),
      };
      state.businessOnboardingStep = 0;
      state.businessOnboardingOpen = true;
    }
  }
  if ('businessEntries' in loaded) state.businessEntries = loaded.businessEntries || [];
  if ('businessContacts' in loaded) state.businessContacts = loaded.businessContacts || [];
  if ('businessOfferings' in loaded) state.businessOfferings = loaded.businessOfferings || [];
  if ('productReport' in loaded) state.productReport = loaded.productReport;
  if ('businessReport' in loaded) state.businessReport = loaded.businessReport;
  localStorage.removeItem('econoapp.budgets');
  return { warnings: state.loadWarnings };
}

function monthPeriod(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { startDate: localDateKey(start), endDate: localDateKey(end) };
}

function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
