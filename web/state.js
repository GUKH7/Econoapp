const configuredApiUrl = window.ECONOAPP_CONFIG?.apiUrl;
const defaultApiUrl = configuredApiUrl || `${location.origin}/api/v1`;
const storedApiUrl = localStorage.getItem('econoapp.apiUrl');

export const state = {
  apiUrl: storedApiUrl && !storedApiUrl.includes(':3001') ? storedApiUrl : defaultApiUrl,
  accessToken: localStorage.getItem('econoapp.accessToken') || '',
  refreshToken: localStorage.getItem('econoapp.refreshToken') || '',
  user: null,
  dashboard: null,
  transactions: [],
  categories: [],
  channels: [],
  tab: 'dashboard',
  manageSection: '',
  manageAccountTab: 'accounts',
  manageModal: '',
  scope: localStorage.getItem('econoapp.scope') || 'PERSONAL',
  fabOpen: false,
  sheetOpen: false,
  transactionSuccess: null,
  quickType: 'EXPENSE',
  scopes: JSON.parse(localStorage.getItem('econoapp.transactionScopes') || '{}'),
  paymentMeta: JSON.parse(localStorage.getItem('econoapp.paymentMeta') || '{}'),
  categoryKinds: JSON.parse(localStorage.getItem('econoapp.categoryKinds') || '{}'),
  wallets: [],
  cards: [],
  budgets: {},
  budgetSummary: null,
  categoryBudgets: [],
  categoryColor: '#22C55E',
  onboardingDismissed: localStorage.getItem('econoapp.onboardingDismissed') === 'true',
  transactionFilter: 'ALL',
  transactionSearch: '',
  reportType: 'EXPENSE',
  whatsappStatus: null,
  whatsappLoading: false,
  whatsappError: '',
  assistantMessages: [],
  assistantLoading: false,
  assistantError: '',
};

export const app = document.querySelector('#app');
export const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});
export const colors = ['#22C55E', '#166534', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export function saveSession(tokens) {
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  localStorage.setItem('econoapp.accessToken', state.accessToken);
  localStorage.setItem('econoapp.refreshToken', state.refreshToken);
}

export function saveScopes() {
  localStorage.setItem('econoapp.transactionScopes', JSON.stringify(state.scopes));
  localStorage.setItem('econoapp.scope', state.scope);
}

export function savePaymentData() {
  localStorage.setItem('econoapp.paymentMeta', JSON.stringify(state.paymentMeta));
}

export function saveCategoryKinds() {
  localStorage.setItem('econoapp.categoryKinds', JSON.stringify(state.categoryKinds));
}

export function saveOnboardingDismissed() {
  localStorage.setItem('econoapp.onboardingDismissed', String(state.onboardingDismissed));
}

export function clearSession() {
  localStorage.removeItem('econoapp.accessToken');
  localStorage.removeItem('econoapp.refreshToken');
  state.accessToken = '';
  state.refreshToken = '';
  state.assistantMessages = [];
  state.assistantLoading = false;
  state.assistantError = '';
}
