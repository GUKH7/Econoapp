import { api, loadData } from './api.js';
import {
  app,
  clearSession,
  saveBudgets,
  saveCategoryKinds,
  savePaymentData,
  saveScopes,
  saveSession,
  state,
} from './state.js';
import { escapeHtml, parseAmount, transitionTo } from './utils.js';
import {
  paymentMetaFromValue,
  paymentTargetFromValue,
  scopedTotals,
  scopeLabel,
} from './finance.js';
import {
  balanceCard,
  fabMenu,
  metricCard,
  tabButton,
  transactionSheet,
  viewHtml,
} from './views.js';

const MAIN_TABS = ['dashboard', 'transactions', 'reports', 'budget', 'more'];

function setError(message) {
  const target = document.querySelector('[data-error]');
  if (target) target.textContent = message || '';
  if (target) target.classList.toggle('hidden', !message);
}

function renderWithTransition(mutator, direction = 'forward') {
  transitionTo(() => {
    mutator();
    renderApp();
  }, direction);
}

function transitionDirectionForTab(targetTab) {
  const currentIndex = MAIN_TABS.indexOf(state.tab);
  const targetIndex = MAIN_TABS.indexOf(targetTab);
  if (currentIndex < 0 || targetIndex < 0) return 'forward';
  return targetIndex >= currentIndex ? 'forward' : 'back';
}

function switchTab(targetTab) {
  if (targetTab === state.tab) return;
  renderWithTransition(() => {
    state.tab = targetTab;
    state.fabOpen = false;
  }, transitionDirectionForTab(targetTab));
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
    clearSession();
    renderAuth(error.message);
  }
}

function renderAuth(initialError = '') {
  app.innerHTML = `
    <section class="auth-shell">
      <div>
        <h1 class="wordmark">Econo<span>App</span></h1>
        <h2 class="auth-title">Financas simples, controle inteligente.</h2>
        <p class="auth-subtitle">Separe pessoal e negocio, acompanhe entradas, gastos, canais e categorias em um painel claro.</p>
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
      <details class="inline-create">
        <summary>Configuracao avancada</summary>
        <label class="field">API<input name="apiUrl" value="${escapeHtml(state.apiUrl)}" required /></label>
      </details>
      <button class="button" type="submit">Criar conta</button>
    `;
  }

  return `
    <label class="field">Telefone ou email<input name="login" autocomplete="username" required /></label>
    <label class="field">Senha<input name="password" type="password" autocomplete="current-password" required /></label>
    <details class="inline-create">
      <summary>Configuracao avancada</summary>
      <label class="field">API<input name="apiUrl" value="${escapeHtml(state.apiUrl)}" required /></label>
    </details>
    <button class="button" type="submit">Entrar</button>
  `;
}

async function handleAuth(event) {
  event.preventDefault();
  setError('');
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  state.apiUrl = data.apiUrl || state.apiUrl;
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
        <div class="app-heading">
          <div class="brand-row compact">
            <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
            <h1 class="wordmark">Econo<span>App</span></h1>
          </div>
          <p>${state.scope === 'BUSINESS' ? 'Meu negocio' : 'Visao geral'}</p>
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

      <section class="grid" id="view" data-swipe-area>${viewHtml()}</section>

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

function bindShellEvents() {
  document.querySelector('[data-scope]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    if (button.dataset.value === state.scope) return;
    const switcher = event.currentTarget;
    switcher.classList.add('switching');
    setTimeout(() => {
      state.scope = button.dataset.value;
      saveScopes();
      loadData()
        .then(() => renderWithTransition(() => {}))
        .catch((error) => alert(error.message));
    }, 90);
  });

  document.querySelector('[data-tabs]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    switchTab(button.dataset.tab);
  });

  document.querySelector('[data-fab]')?.addEventListener('click', () => {
    renderWithTransition(() => {
      state.fabOpen = !state.fabOpen;
    });
  });

  document.querySelector('[data-fab-close]')?.addEventListener('click', () => {
    renderWithTransition(() => {
      state.fabOpen = false;
    });
  });

  document.querySelectorAll('[data-action-type]').forEach((button) => {
    button.addEventListener('click', () => {
      renderWithTransition(() => {
        state.quickType = button.dataset.actionType;
        state.fabOpen = false;
        state.sheetOpen = true;
      });
    });
  });

  document.querySelectorAll('[data-sheet-close]').forEach((element) => {
    element.addEventListener('click', () => {
      renderWithTransition(() => {
        state.sheetOpen = false;
      });
    });
  });

  bindSwipeNavigation();
}

function bindViewEvents() {
  document.querySelector('[data-logout]')?.addEventListener('click', () => {
    clearSession();
    renderAuth();
  });

  document.querySelectorAll('[data-tab-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tabJump;
      if (target === 'more-manage') {
        document.querySelector('[data-category-form]')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (MAIN_TABS.includes(target)) {
        switchTab(target);
        return;
      }
      renderWithTransition(() => {
        state.tab = target;
      });
    });
  });

  document.querySelectorAll('[data-transaction-form]').forEach((form) =>
    form.addEventListener('submit', handleTransactionSubmit),
  );

  document.querySelector('[data-category-form]')?.addEventListener('submit', handleCategorySubmit);
  document.querySelector('[data-channel-form]')?.addEventListener('submit', handleChannelSubmit);
  document.querySelector('[data-wallet-form]')?.addEventListener('submit', handleWalletSubmit);
  document.querySelector('[data-card-form]')?.addEventListener('submit', handleCardSubmit);
  document.querySelector('[data-budget-form]')?.addEventListener('submit', handleBudgetSubmit);

  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', () => {
      state.categoryColor = button.dataset.color;
      renderApp();
    });
  });

  document.querySelectorAll('[data-transaction-type]').forEach((select) => {
    select.addEventListener('change', () => {
      renderWithTransition(() => {
        state.quickType = select.value;
      });
    });
  });
}

function bindSwipeNavigation() {
  const area = document.querySelector('[data-swipe-area]');
  if (!area || !MAIN_TABS.includes(state.tab)) return;

  let startX = 0;
  let startY = 0;
  let pointerId = null;
  let isTracking = false;

  const interactiveSelector = [
    'button',
    'input',
    'select',
    'textarea',
    'a',
    'summary',
    '.bottom-sheet',
    '.tabs',
    '.fab',
    '[data-fab-close]',
    '[data-sheet-close]',
  ].join(',');

  area.addEventListener('pointerdown', (event) => {
    if (state.sheetOpen || state.fabOpen) return;
    if (event.target.closest(interactiveSelector)) return;
    startX = event.clientX;
    startY = event.clientY;
    pointerId = event.pointerId;
    isTracking = true;
    area.setPointerCapture?.(pointerId);
  });

  area.addEventListener('pointermove', (event) => {
    if (!isTracking || event.pointerId !== pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.25) {
      isTracking = false;
      area.releasePointerCapture?.(pointerId);
      return;
    }
    if (Math.abs(deltaX) > 12) {
      area.style.setProperty('--swipe-offset', `${Math.max(-34, Math.min(34, deltaX / 4))}px`);
      area.classList.add('is-swiping');
    }
  });

  area.addEventListener('pointerup', (event) => {
    if (!isTracking || event.pointerId !== pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    isTracking = false;
    area.releasePointerCapture?.(pointerId);
    area.classList.remove('is-swiping');
    area.style.removeProperty('--swipe-offset');

    if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
    const currentIndex = MAIN_TABS.indexOf(state.tab);
    const targetIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const targetTab = MAIN_TABS[targetIndex];
    if (!targetTab) return;
    switchTab(targetTab);
  });

  area.addEventListener('pointercancel', () => {
    isTracking = false;
    area.classList.remove('is-swiping');
    area.style.removeProperty('--swipe-offset');
  });
}

async function handleTransactionSubmit(event) {
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

    const paymentTarget =
      data.type === 'EXPENSE' ? paymentTargetFromValue(data.paymentMethod) : { accountId: data.receiveAccount };

    const response = await api().createTransaction({
      description: data.description,
      amount: parseAmount(data.amount),
      type: data.type,
      source: 'MANUAL',
      scope: state.scope,
      categoryId,
      channelId: data.channelId || undefined,
      accountId: paymentTarget.accountId || undefined,
      creditCardId: paymentTarget.creditCardId || undefined,
    });
    if (data.type === 'EXPENSE' && data.paymentMethod) {
      state.paymentMeta[response.data.id] = paymentMetaFromValue(data.paymentMethod);
    }
    if (data.type === 'INCOME' && data.receiveAccount) {
      state.paymentMeta[response.data.id] = paymentMetaFromValue(`account:${data.receiveAccount}`, 'RECEIVE');
    }
    saveScopes();
    savePaymentData();
    await loadData();
    state.sheetOpen = false;
    renderApp();
  } catch (error) {
    alert(error.message);
  }
}

async function handleCategorySubmit(event) {
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
}

async function handleChannelSubmit(event) {
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
}

function handleWalletSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  api()
    .createAccount({
      name: String(data.name).trim(),
      type: data.type,
      balance: parseAmount(data.balance || '0'),
      scope: state.scope,
    })
    .then(loadData)
    .then(renderApp)
    .catch((error) => alert(error.message));
}

function handleCardSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  api()
    .createCard({
      name: String(data.name).trim(),
      limit: parseAmount(data.limit || '0'),
      scope: state.scope,
    })
    .then(loadData)
    .then(renderApp)
    .catch((error) => alert(error.message));
}

function handleBudgetSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.budgets[state.scope] = parseAmount(data.budget);
  saveBudgets();
  renderApp();
}

bootstrap();
