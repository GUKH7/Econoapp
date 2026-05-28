const defaultApiUrl = `${location.protocol}//${location.hostname}:3001/api/v1`;
const state = {
  apiUrl: localStorage.getItem('econoapp.apiUrl') || defaultApiUrl,
  accessToken: localStorage.getItem('econoapp.accessToken') || '',
  refreshToken: localStorage.getItem('econoapp.refreshToken') || '',
  user: null,
  dashboard: null,
  transactions: [],
  categories: [],
  channels: [],
  tab: 'dashboard',
  scope: localStorage.getItem('econoapp.scope') || 'PERSONAL',
  fabOpen: false,
  sheetOpen: false,
  quickType: 'EXPENSE',
  scopes: JSON.parse(localStorage.getItem('econoapp.transactionScopes') || '{}'),
  paymentMeta: JSON.parse(localStorage.getItem('econoapp.paymentMeta') || '{}'),
  categoryKinds: JSON.parse(localStorage.getItem('econoapp.categoryKinds') || '{}'),
  wallets: JSON.parse(
    localStorage.getItem('econoapp.wallets') ||
      '[{"id":"wallet-main","name":"Carteira principal","type":"WALLET","balance":0}]',
  ),
  cards: JSON.parse(localStorage.getItem('econoapp.cards') || '[]'),
  budgets: JSON.parse(localStorage.getItem('econoapp.budgets') || '{}'),
  categoryColor: '#007338',
};

const app = document.querySelector('#app');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const colors = ['#28B463', '#CBA64B', '#EF5350', '#7EA2FF', '#8F5CF7', '#E85D9E'];

function saveSession(tokens) {
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  localStorage.setItem('econoapp.accessToken', state.accessToken);
  localStorage.setItem('econoapp.refreshToken', state.refreshToken);
}

function saveScopes() {
  localStorage.setItem('econoapp.transactionScopes', JSON.stringify(state.scopes));
  localStorage.setItem('econoapp.scope', state.scope);
}

function saveBudgets() {
  localStorage.setItem('econoapp.budgets', JSON.stringify(state.budgets));
}

function savePaymentData() {
  localStorage.setItem('econoapp.paymentMeta', JSON.stringify(state.paymentMeta));
  localStorage.setItem('econoapp.wallets', JSON.stringify(state.wallets));
  localStorage.setItem('econoapp.cards', JSON.stringify(state.cards));
}

function saveCategoryKinds() {
  localStorage.setItem('econoapp.categoryKinds', JSON.stringify(state.categoryKinds));
}

function transitionTo(mutator) {
  const apply = () => {
    mutator();
    renderApp();
  };

  if (document.startViewTransition) {
    document.startViewTransition(apply);
    return;
  }

  apply();
}

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
      throw new Error('A API demorou para responder. Confira o backend e o IP configurado.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function api() {
  return {
    login: (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
    register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
    me: () => request('/auth/me'),
    dashboard: () => request('/dashboard'),
    transactions: () => request('/transactions?limit=100'),
    categories: () => request('/categories'),
    channels: () => request('/channels'),
    createTransaction: (payload) =>
      request('/transactions', { method: 'POST', body: JSON.stringify(payload) }),
    createCategory: (payload) =>
      request('/categories', { method: 'POST', body: JSON.stringify(payload) }),
    createChannel: (payload) =>
      request('/channels', { method: 'POST', body: JSON.stringify(payload) }),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseAmount(value) {
  const normalized = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function transactionScope(transaction) {
  if (state.scopes[transaction.id]) return state.scopes[transaction.id];
  if (transaction.channelId) return 'BUSINESS';
  return 'PERSONAL';
}

function scopedTransactions() {
  return state.transactions.filter((transaction) => transactionScope(transaction) === state.scope);
}

function scopedTotals() {
  return scopedTransactions().reduce(
    (acc, transaction) => {
      const value = Number(transaction.netAmount || transaction.amount || 0);
      if (transaction.type === 'INCOME') acc.income += value;
      if (transaction.type === 'EXPENSE') acc.expense += value;
      acc.balance = acc.income - acc.expense;
      return acc;
    },
    { income: 0, expense: 0, balance: 0 },
  );
}

function scopeLabel() {
  return state.scope === 'BUSINESS' ? 'Negocio' : 'Pessoal';
}

function setError(message) {
  const target = document.querySelector('[data-error]');
  if (target) target.textContent = message || '';
  if (target) target.classList.toggle('hidden', !message);
}

async function loadData() {
  const client = api();
  const [me, dashboard, transactions, categories, channels] = await Promise.all([
    client.me(),
    client.dashboard(),
    client.transactions(),
    client.categories(),
    client.channels(),
  ]);
  state.user = me.data;
  state.dashboard = dashboard.data;
  state.transactions = transactions.data;
  state.categories = categories.data;
  state.channels = channels.data;
}

async function bootstrap() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (!state.accessToken) {
    renderAuth();
    return;
  }

  try {
    await loadData();
    renderApp();
  } catch (error) {
    state.accessToken = '';
    localStorage.removeItem('econoapp.accessToken');
    renderAuth(error.message);
  }
}

function renderAuth(initialError = '') {
  app.innerHTML = `
    <section class="auth-shell">
      <div>
        <h1 class="wordmark">ECONOAPP</h1>
        <h2 class="auth-title">Controle sua grana sem misturar tudo.</h2>
        <p class="auth-subtitle">Separe pessoal e negocio, acompanhe entradas, gastos, canais e categorias.</p>
      </div>

      <div class="card">
        <div class="auth-switch" data-auth-tabs>
          <button class="active" type="button" data-mode="login">Entrar</button>
          <button type="button" data-mode="register">Cadastrar</button>
        </div>
        <p class="error ${initialError ? '' : 'hidden'}" data-error>${escapeHtml(initialError)}</p>
        <form class="form" data-auth-form data-mode="login">
          ${authFields('login')}
        </form>
      </div>
    </section>
  `;

  document.querySelector('[data-auth-tabs]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    document.querySelectorAll('[data-auth-tabs] button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const form = document.querySelector('[data-auth-form]');
    form.dataset.mode = button.dataset.mode;
    form.innerHTML = authFields(button.dataset.mode);
  });

  document.querySelector('[data-auth-form]').addEventListener('submit', handleAuth);
}

function authFields(mode) {
  if (mode === 'register') {
    return `
      <label class="field">Nome<input name="name" autocomplete="name" required /></label>
      <label class="field">Telefone<input name="phone" inputmode="tel" required /></label>
      <label class="field">Email<input name="email" type="email" autocomplete="email" /></label>
      <label class="field">Senha<input name="password" type="password" minlength="8" required /></label>
      <label class="field">API<input name="apiUrl" value="${escapeHtml(state.apiUrl)}" required /></label>
      <button class="button" type="submit">Criar conta</button>
    `;
  }

  return `
    <label class="field">Telefone ou email<input name="login" autocomplete="username" required /></label>
    <label class="field">Senha<input name="password" type="password" autocomplete="current-password" required /></label>
    <label class="field">API<input name="apiUrl" value="${escapeHtml(state.apiUrl)}" required /></label>
    <button class="button" type="submit">Entrar</button>
  `;
}

async function handleAuth(event) {
  event.preventDefault();
  setError('');
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  state.apiUrl = data.apiUrl;
  localStorage.setItem('econoapp.apiUrl', state.apiUrl);

  try {
    const client = api();
    const response =
      form.dataset.mode === 'register'
        ? await client.register({
            name: data.name,
            phone: String(data.phone).replace(/\D/g, ''),
            email: data.email || undefined,
            password: data.password,
          })
        : await client.login({
            [String(data.login).includes('@') ? 'email' : 'phone']: String(data.login).includes('@')
              ? data.login
              : String(data.login).replace(/\D/g, ''),
            password: data.password,
          });

    saveSession(response.data);
    await loadData();
    renderApp();
  } catch (error) {
    setError(error.message);
  }
}

function renderApp() {
  const totals = scopedTotals();
  app.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <div>
          <h1 class="wordmark">ECONOAPP</h1>
        </div>
        <div class="scope-switch" data-scope>
          <button class="${state.scope === 'PERSONAL' ? 'active' : ''}" type="button" data-value="PERSONAL">Pessoal</button>
          <button class="${state.scope === 'BUSINESS' ? 'active' : ''}" type="button" data-value="BUSINESS">Negocio</button>
        </div>
      </header>

      <section class="grid dashboard-grid">
        ${balanceCard(`Saldo ${scopeLabel()}`, totals.balance)}
        ${metricCard('Receitas', totals.income, 'income')}
        ${metricCard('Gastos', totals.expense, 'expense')}
      </section>

      <section class="grid" id="view">${viewHtml()}</section>

      <nav class="tabs" data-tabs>
        ${tabButton('dashboard', 'Inicio')}
        ${tabButton('transactions', 'Fluxo')}
        ${tabButton('reports', 'Relatorios')}
        ${tabButton('budget', 'Limites')}
        ${tabButton('more', 'Mais')}
      </nav>
      <button class="fab ${state.fabOpen ? 'open' : ''}" type="button" data-fab aria-label="Adicionar">+</button>
      ${state.fabOpen ? fabMenu() : ''}
      ${state.sheetOpen ? transactionSheet() : ''}
    </section>
  `;

  bindShellEvents();
  bindViewEvents();
}

function metricCard(label, value, className = '') {
  return `
    <article class="mini-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value ${className}">${money.format(value)}</div>
    </article>
  `;
}

function balanceCard(label, value) {
  return `
    <article class="balance-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${money.format(value)}</div>
      <div class="month-title"><span>Maio</span><span>${scopedTransactions().length} lancamentos</span></div>
    </article>
  `;
}

function tabButton(id, label) {
  const icons = {
    dashboard: '⌂',
    transactions: '⇄',
    reports: '▥',
    budget: '◎',
    more: '•••',
  };
  return `<button class="${state.tab === id ? 'active' : ''}" type="button" data-tab="${id}"><span class="tab-icon">${icons[id]}</span>${label}</button>`;
}

function fabMenu() {
  return `
    <div class="fab-menu" data-fab-close></div>
    <div class="fab-actions">
      <button class="fab-action" type="button" data-action-type="INCOME"><span class="row-icon" style="background:#28B463">↑</span>Receita</button>
      <button class="fab-action" type="button" data-action-type="EXPENSE"><span class="row-icon" style="background:#EF5350">↓</span>Gasto</button>
    </div>
  `;
}

function transactionSheet() {
  const type = state.quickType || 'EXPENSE';
  const isIncome = type === 'INCOME';
  return `
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="${isIncome ? 'Nova receita' : 'Novo gasto'}">
      <div class="sheet-handle"></div>
      <div class="panel-title">
        <h2>${isIncome ? 'Nova receita' : 'Novo gasto'}</h2>
        <button class="icon-button" type="button" data-sheet-close aria-label="Fechar">×</button>
      </div>
      ${transactionFormHtml(type, 'sheet')}
    </section>
  `;
}

function viewHtml() {
  if (state.tab === 'transactions') return transactionsView();
  if (state.tab === 'reports') return reportsView();
  if (state.tab === 'budget') return budgetView();
  if (state.tab === 'more') return moreView();
  if (state.tab === 'launch') return launchView();
  return dashboardView();
}

function dashboardView() {
  const rows = scopedTransactions().slice(0, 8).map(transactionRow).join('');
  const categories = state.categories
    .map((category) => `<span class="chip"><span class="dot" style="background:${category.color}"></span>${escapeHtml(category.name)}</span>`)
    .join('');

  return `
    <div class="split">
      <article class="card">
        <div class="panel-title"><h2>Fluxo recente</h2><button class="button secondary" type="button" data-tab-jump="transactions">Ver tudo</button></div>
        ${rows || emptyState('Nenhum lancamento no periodo', 'Toque no + para adicionar uma receita ou gasto.', '+')}
      </article>
      <article class="card">
        <div class="panel-title"><h2>Categorias</h2><button class="button secondary" type="button" data-tab-jump="more">Editar</button></div>
        <div class="chip-list">${categories || '<p class="empty">Crie categorias para organizar os lancamentos.</p>'}</div>
      </article>
    </div>
  `;
}

function transactionsView() {
  const rows = scopedTransactions().map(transactionRow).join('');
  return `
    <h2 class="section-title">Fluxo de caixa</h2>
    <div class="period-switch">
      <button type="button">Abril</button>
      <button class="active" type="button">Maio</button>
      <button type="button">Junho</button>
    </div>
    <article class="card">
      ${rows || emptyState('Nenhum lancamento no periodo', 'Toque no + para adicionar um lancamento.', '+')}
    </article>
  `;
}

function launchView() {
  const type = state.quickType || 'EXPENSE';
  const isIncome = type === 'INCOME';
  return `
    <h2 class="section-title">${isIncome ? 'Nova receita' : 'Novo gasto'}</h2>
    <div class="split">
      <article class="card">
        ${transactionFormHtml(type, 'page')}
      </article>
      <article class="card">
        <div class="panel-title"><h2>Registros ${scopeLabel()}</h2></div>
        ${scopedTransactions().slice(0, 12).map(transactionRow).join('') || '<p class="empty">Nenhum registro ainda.</p>'}
      </article>
    </div>
  `;
}

function transactionFormHtml(type, context) {
  const isExpense = type === 'EXPENSE';
  const categoryLabel = isExpense ? 'Categoria do gasto' : 'Origem da receita';
  const createCategoryLabel = isExpense ? 'Criar nova categoria de gasto' : 'Criar nova origem de receita';
  const availableCategories = state.categories.filter((category) => {
    const kind = state.categoryKinds[category.id];
    if (isExpense) return !kind || kind === 'EXPENSE';
    return kind === 'INCOME';
  });
  const walletOptions = state.wallets
    .map(
      (wallet) =>
        `<option value="wallet:${wallet.id}">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} - ${escapeHtml(wallet.name)}</option>`,
    )
    .join('');
  const expensePaymentOptions = [
    walletOptions,
    ...state.cards.map((card) => `<option value="card:${card.id}">Cartao - ${escapeHtml(card.name)}</option>`),
  ].join('');

  return `
    <form class="form" data-transaction-form data-context="${context}">
      <label class="field">Tipo
        <select name="type" data-transaction-type>
          <option value="EXPENSE" ${type === 'EXPENSE' ? 'selected' : ''}>Gasto</option>
          <option value="INCOME" ${type === 'INCOME' ? 'selected' : ''}>Receita</option>
        </select>
      </label>
      <label class="field">Valor<input class="amount-input" name="amount" inputmode="decimal" required placeholder="R$ 0,00" /></label>
      <label class="field">Descricao<input name="description" required placeholder="Ex: Mercado, venda Shopee, frete" /></label>
      <label class="field">${categoryLabel}
        <select name="categoryId" ${availableCategories.length ? 'required' : ''}>
          ${availableCategories.length ? availableCategories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('') : '<option value="">Crie uma nova abaixo</option>'}
        </select>
      </label>
      <details class="inline-create" ${availableCategories.length ? '' : 'open'}>
        <summary>${createCategoryLabel}</summary>
        <label class="field">Nome<input name="newCategoryName" placeholder="${isExpense ? 'Ex: Alimentacao, Frete, Taxas' : 'Ex: Salario, Vendas, Rendimentos'}" /></label>
        <div class="field">
          <label>Cor</label>
          <div class="swatches">${colors.map((color) => `<button class="swatch ${state.categoryColor === color ? 'active' : ''}" type="button" style="background:${color}" data-color="${color}"></button>`).join('')}</div>
        </div>
      </details>
      <label class="field ${isExpense ? '' : 'hidden'}">Forma de pagamento
        <select name="paymentMethod" ${isExpense ? 'required' : ''}>
          ${expensePaymentOptions || '<option value="">Cadastre uma carteira, banco ou cartao</option>'}
        </select>
      </label>
      <label class="field ${isExpense ? 'hidden' : ''}">Receber em
        <select name="receiveAccount" ${isExpense ? '' : 'required'}>
          ${walletOptions || '<option value="">Cadastre um banco ou carteira</option>'}
        </select>
      </label>
      <label class="field ${state.scope === 'BUSINESS' ? '' : 'hidden'}">Canal ou meio
        <select name="channelId">
          <option value="">Sem canal</option>
          ${state.channels.map((channel) => `<option value="${channel.id}">${escapeHtml(channel.name)}</option>`).join('')}
        </select>
      </label>
      <button class="button" type="submit">Salvar lancamento</button>
    </form>
  `;
}

function manageView() {
  return `
    <div class="split">
      <article class="card">
        <div class="panel-title"><h2>Bancos e carteiras</h2></div>
        <form class="form" data-wallet-form>
          <label class="field">Nome<input name="name" required placeholder="Ex: Nubank, Inter, Dinheiro" /></label>
          <label class="field">Tipo
            <select name="type">
              <option value="BANK">Banco</option>
              <option value="WALLET">Carteira</option>
            </select>
          </label>
          <label class="field">Saldo inicial<input name="balance" inputmode="decimal" placeholder="0,00" /></label>
          <button class="button" type="submit">Criar conta</button>
        </form>
        <div style="margin-top:14px">
          ${state.wallets.map((wallet) => `<div class="row"><div><div class="row-title">${escapeHtml(wallet.name)}</div><div class="row-meta">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} - ${money.format(Number(wallet.balance || 0))}</div></div></div>`).join('')}
        </div>
      </article>

      <article class="card">
        <div class="panel-title"><h2>Cartoes de credito</h2></div>
        <form class="form" data-card-form>
          <label class="field">Nome<input name="name" required placeholder="Ex: Nubank credito, Inter Black" /></label>
          <label class="field">Limite<input name="limit" inputmode="decimal" placeholder="0,00" /></label>
          <button class="button" type="submit">Criar cartao</button>
        </form>
        <div style="margin-top:14px">
          ${state.cards.map((card) => `<div class="row"><div><div class="row-title">${escapeHtml(card.name)}</div><div class="row-meta">Limite ${money.format(Number(card.limit || 0))}</div></div></div>`).join('') || '<p class="empty">Cadastre cartoes para registrar gastos no credito.</p>'}
        </div>
      </article>

      <article class="card">
        <div class="panel-title"><h2>Categorias</h2></div>
        <form class="form" data-category-form>
          <label class="field">Nome<input name="name" required placeholder="Ex: Alimentacao, Moradia, Taxas" /></label>
          <label class="field">Uso
            <select name="kind">
              <option value="EXPENSE">Gasto</option>
              <option value="INCOME">Receita</option>
            </select>
          </label>
          <div class="field">
            <label>Cor</label>
            <div class="swatches">${colors.map((color) => `<button class="swatch ${state.categoryColor === color ? 'active' : ''}" type="button" style="background:${color}" data-color="${color}"></button>`).join('')}</div>
          </div>
          <button class="button" type="submit">Criar categoria</button>
        </form>
        <div class="chip-list" style="margin-top:14px">
          ${state.categories.map((category) => `<span class="chip"><span class="dot" style="background:${category.color}"></span>${escapeHtml(category.name)}${state.categoryKinds[category.id] === 'INCOME' ? ' · receita' : state.categoryKinds[category.id] === 'EXPENSE' ? ' · gasto' : ''}</span>`).join('')}
        </div>
      </article>

      <article class="card">
        <div class="panel-title"><h2>Canais de venda e meios</h2></div>
        <form class="form" data-channel-form>
          <label class="field">Nome<input name="name" required placeholder="Ex: Shopee, Mercado Livre, Pix Loja" /></label>
          <label class="field">Taxa (%)<input name="feePercent" inputmode="decimal" value="0" /></label>
          <button class="button" type="submit">Criar canal</button>
        </form>
        <div style="margin-top:14px">
          ${state.channels.map((channel) => `<div class="row"><div><div class="row-title">${escapeHtml(channel.name)}</div><div class="row-meta">Taxa ${Number(channel.feePercent).toFixed(2)}%</div></div></div>`).join('') || '<p class="empty">Cadastre canais para separar vendas do negocio.</p>'}
        </div>
      </article>
    </div>
  `;
}

function reportsView() {
  const incomeByCategory = totalsByCategory('INCOME');
  const expenseByCategory = totalsByCategory('EXPENSE');
  return `
    <h2 class="section-title">Relatorios</h2>
    <div class="period-switch">
      <button type="button">Abril</button>
      <button class="active" type="button">Maio</button>
      <button type="button">Junho</button>
    </div>
    <div class="split">
      <article class="card">
        <div class="panel-title"><h2>Despesas</h2></div>
        ${categoryRows(expenseByCategory) || '<p class="empty">Nao ha dados disponiveis no periodo.</p>'}
      </article>
      <article class="card">
        <div class="panel-title"><h2>Receitas</h2></div>
        ${categoryRows(incomeByCategory) || '<p class="empty">Nao ha dados disponiveis no periodo.</p>'}
      </article>
    </div>
  `;
}

function budgetView() {
  const key = state.scope;
  const currentBudget = Number(state.budgets[key] || 0);
  const totals = scopedTotals();
  const used = currentBudget > 0 ? Math.min(100, (totals.expense / currentBudget) * 100) : 0;
  return `
    <h2 class="section-title">Limites de gastos</h2>
    <div class="period-switch">
      <button type="button">Abril</button>
      <button class="active" type="button">Maio</button>
      <button type="button">Junho</button>
    </div>
    <article class="card">
      ${
        currentBudget
          ? `<div class="panel-title"><h2>Limite ${scopeLabel()}</h2><strong>${money.format(currentBudget)}</strong></div>
             <div class="budget-progress"><span style="width:${used}%"></span></div>
             <p class="muted">${money.format(totals.expense)} usados de ${money.format(currentBudget)}</p>`
          : emptyState('Nenhum limite definido', 'Defina um teto de gastos para acompanhar o mes.', '◎')
      }
      <form class="form" data-budget-form style="margin-top:18px">
        <label class="field">Novo limite<input name="budget" inputmode="decimal" placeholder="0,00" /></label>
        <button class="button" type="submit">Definir limite</button>
      </form>
    </article>
  `;
}

function moreView() {
  return `
    <div class="split">
      <article class="card">
        <div class="panel-title"><h2>Perfil</h2></div>
        <div class="row"><div><div class="row-title">${escapeHtml(state.user?.name)}</div><div class="row-meta">${escapeHtml(state.user?.phone)} ${state.user?.email ? `- ${escapeHtml(state.user.email)}` : ''}</div></div></div>
        <button class="button danger" type="button" data-logout>Sair</button>
      </article>
      <article class="card">
        <div class="panel-title"><h2>Gerenciar</h2></div>
        <div class="menu-list">
          <button class="menu-item" type="button" data-tab-jump="launch"><span class="tab-icon">⇄</span><span>Lancamentos</span><span>›</span></button>
          <button class="menu-item" type="button" data-tab-jump="more-manage"><span class="tab-icon">▦</span><span>Categorias e canais</span><span>›</span></button>
          <button class="menu-item" type="button" data-tab-jump="budget"><span class="tab-icon">◎</span><span>Limites</span><span>›</span></button>
        </div>
      </article>
      ${manageView()}
    </div>
  `;
}

function emptyState(title, copy, icon) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <div><strong>${title}</strong><span>${copy}</span></div>
    </div>
  `;
}

function totalsByCategory(type) {
  const byId = new Map(state.categories.map((category) => [category.id, { ...category, total: 0 }]));
  scopedTransactions()
    .filter((transaction) => transaction.type === type)
    .forEach((transaction) => {
      const category = byId.get(transaction.categoryId);
      if (category) category.total += Number(transaction.netAmount || transaction.amount || 0);
    });
  return [...byId.values()].filter((category) => category.total > 0);
}

function categoryRows(items) {
  return items
    .map(
      (category) => `
        <div class="row">
          <div style="display:flex;align-items:center;gap:12px">
            <span class="row-icon" style="background:${category.color}">${category.name.slice(0, 1).toUpperCase()}</span>
            <div class="row-title">${escapeHtml(category.name)}</div>
          </div>
          <strong>${money.format(category.total)}</strong>
        </div>
      `,
    )
    .join('');
}

function transactionRow(transaction) {
  const value = Number(transaction.netAmount || transaction.amount || 0);
  const typeClass = transaction.type === 'EXPENSE' ? 'expense' : 'income';
  const category = state.categories.find((item) => item.id === transaction.categoryId);
  const payment = state.paymentMeta[transaction.id];
  const iconText = transaction.type === 'EXPENSE' ? '↓' : '↑';
  const iconColor = transaction.type === 'EXPENSE' ? '#EF5350' : '#28B463';
  const paymentLabel = payment ? ` - ${escapeHtml(payment.label)}` : '';
  return `
    <div class="row">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        <span class="row-icon" style="background:${category?.color || iconColor}">${iconText}</span>
        <div>
          <div class="row-title">${escapeHtml(transaction.description)}</div>
          <div class="row-meta">${dateFmt.format(new Date(transaction.date))} - ${category?.name || transaction.source}${paymentLabel} - ${transactionScope(transaction) === 'BUSINESS' ? 'Negocio' : 'Pessoal'}</div>
        </div>
      </div>
      <strong class="${typeClass}">${money.format(value)}</strong>
    </div>
  `;
}

function bindShellEvents() {
  document.querySelector('[data-scope]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    if (button.dataset.value === state.scope) return;
    const switcher = event.currentTarget;
    switcher.classList.add('switching');
    setTimeout(() => {
      transitionTo(() => {
        state.scope = button.dataset.value;
        saveScopes();
      });
    }, 90);
  });

  document.querySelector('[data-tabs]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    transitionTo(() => {
      state.tab = button.dataset.tab;
      state.fabOpen = false;
    });
  });

  document.querySelector('[data-fab]')?.addEventListener('click', () => {
    transitionTo(() => {
      state.fabOpen = !state.fabOpen;
    });
  });

  document.querySelector('[data-fab-close]')?.addEventListener('click', () => {
    transitionTo(() => {
      state.fabOpen = false;
    });
  });

  document.querySelectorAll('[data-action-type]').forEach((button) => {
    button.addEventListener('click', () => {
      transitionTo(() => {
        state.quickType = button.dataset.actionType;
        state.fabOpen = false;
        state.sheetOpen = true;
      });
    });
  });

  document.querySelectorAll('[data-sheet-close]').forEach((element) => {
    element.addEventListener('click', () => {
      transitionTo(() => {
        state.sheetOpen = false;
      });
    });
  });
}

function bindViewEvents() {
  document.querySelector('[data-logout]')?.addEventListener('click', () => {
    localStorage.removeItem('econoapp.accessToken');
    localStorage.removeItem('econoapp.refreshToken');
    state.accessToken = '';
    renderAuth();
  });

  document.querySelectorAll('[data-tab-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tabJump;
      if (target === 'more-manage') {
        document.querySelector('[data-category-form]')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      transitionTo(() => {
        state.tab = target;
      });
    });
  });

  document.querySelectorAll('[data-transaction-form]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      let categoryId = data.categoryId;
      if (String(data.newCategoryName || '').trim()) {
        const category = await api().createCategory({
          name: String(data.newCategoryName).trim(),
          color: state.categoryColor,
        });
        categoryId = category.data.id;
        state.categoryKinds[categoryId] = data.type;
        saveCategoryKinds();
      }
      if (!categoryId) {
        alert(data.type === 'INCOME' ? 'Escolha ou crie uma origem de receita.' : 'Escolha ou crie uma categoria de gasto.');
        return;
      }

      const response = await api().createTransaction({
        description: data.description,
        amount: parseAmount(data.amount),
        type: data.type,
        source: 'MANUAL',
        categoryId,
        channelId: data.channelId || undefined,
      });
      state.scopes[response.data.id] = state.scope;
      if (data.type === 'EXPENSE' && data.paymentMethod) {
        state.paymentMeta[response.data.id] = paymentMetaFromValue(data.paymentMethod);
      }
      if (data.type === 'INCOME' && data.receiveAccount) {
        state.paymentMeta[response.data.id] = paymentMetaFromValue(data.receiveAccount, 'RECEIVE');
      }
      saveScopes();
      savePaymentData();
      await loadData();
      state.sheetOpen = false;
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  }));

  document.querySelector('[data-category-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const category = await api().createCategory({ name: data.name, color: state.categoryColor });
      state.categoryKinds[category.data.id] = data.kind || 'EXPENSE';
      saveCategoryKinds();
      await loadData();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', () => {
      state.categoryColor = button.dataset.color;
      renderApp();
    });
  });

  document.querySelectorAll('[data-transaction-type]').forEach((select) => {
    select.addEventListener('change', () => {
      transitionTo(() => {
        state.quickType = select.value;
      });
    });
  });

  document.querySelector('[data-channel-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api().createChannel({
        name: data.name,
        feePercent: parseAmount(data.feePercent || '0'),
      });
      await loadData();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('[data-wallet-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.wallets.push({
      id: `wallet-${Date.now()}`,
      name: String(data.name).trim(),
      type: data.type,
      balance: parseAmount(data.balance || '0'),
    });
    savePaymentData();
    renderApp();
  });

  document.querySelector('[data-card-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.cards.push({
      id: `card-${Date.now()}`,
      name: String(data.name).trim(),
      limit: parseAmount(data.limit || '0'),
    });
    savePaymentData();
    renderApp();
  });

  document.querySelector('[data-budget-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.budgets[state.scope] = parseAmount(data.budget);
    saveBudgets();
    renderApp();
  });
}

function paymentMetaFromValue(value, mode = 'PAYMENT') {
  const [kind, id] = String(value).split(':');
  if (kind === 'card') {
    const card = state.cards.find((item) => item.id === id);
    return { kind: 'CARD', id, label: card ? `Cartao ${card.name}` : 'Cartao' };
  }

  const wallet = state.wallets.find((item) => item.id === id);
  return {
    kind: wallet?.type || 'WALLET',
    id,
    label: wallet
      ? `${mode === 'RECEIVE' ? 'Receber em' : wallet.type === 'BANK' ? 'Banco' : 'Carteira'} ${wallet.name}`
      : 'Carteira',
  };
}

bootstrap();
