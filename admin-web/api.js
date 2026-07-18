const configuredApiUrl = window.DIN_ADMIN_CONFIG?.apiUrl;
const state = {
  apiUrl: configuredApiUrl || `${location.origin}/api/v1`,
  accessToken: localStorage.getItem('din.admin.accessToken') || '',
  refreshToken: localStorage.getItem('din.admin.refreshToken') || '',
};
let refreshPromise = null;

function saveSession(tokens) {
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  localStorage.setItem('din.admin.accessToken', tokens.accessToken);
  localStorage.setItem('din.admin.refreshToken', tokens.refreshToken);
}

export function clearSession() {
  state.accessToken = '';
  state.refreshToken = '';
  localStorage.removeItem('din.admin.accessToken');
  localStorage.removeItem('din.admin.refreshToken');
}

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
        const body = await response.json();
        if (!body?.data?.accessToken) return false;
        saveSession(body.data);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(path, options = {}, retrying = false) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);
  const response = await fetch(`${state.apiUrl}${path}`, { ...options, headers });
  if (response.status === 401 && !retrying && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request(path, options, true);
    clearSession();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.message || body?.error || `Erro ${response.status}`;
    throw new Error(Array.isArray(message) ? message.join('\n') : message);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const session = {
  get active() { return Boolean(state.accessToken); },
  save: saveSession,
};

export const api = {
  login: (payload) => request('/auth/admin-login', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/auth/me'),
  overview: () => request('/admin/overview'),
  users: ({ search = '', status = '' } = {}) => {
    const query = new URLSearchParams({ page: '1', limit: '100' });
    if (search) query.set('search', search);
    if (status) query.set('status', status);
    return request(`/admin/users?${query}`);
  },
  updateAccess: (id, status) => request(`/admin/users/${id}/access`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }),
  recordPayment: (id, payload) => request(`/admin/users/${id}/payments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  deleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  whatsappStatus: () => request('/whatsapp/status'),
  whatsappRestart: () => request('/whatsapp/restart'),
};
