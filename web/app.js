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

function screenTitle() {
  const titles = {
    dashboard: 'Resumo',
    transactions: 'Transacoes',
    reports: 'Relatorios',
    budget: 'Limites',
    more: state.manageSection === 'accounts' ? 'Contas e carteiras' : 'Mais',
    launch: 'Lancamentos',
  };
  if (state.scope === 'BUSINESS' && state.tab === 'dashboard') return 'Negocio';
  return titles[state.tab] || 'Resumo';
}

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
      <div class="welcome-panel">
        <div class="brand-row centered">
          <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
          <h1 class="wordmark">Econo<span>App</span></h1>
        </div>
        <h2 class="auth-title">Suas financas pessoais e do seu negocio em um so lugar</h2>
        <div class="welcome-illustration" aria-hidden="true">
          <span class="phone-shape"></span>
          <span class="wallet-shape"></span>
          <span class="bot-shape"><i></i></span>
        </div>
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
    <section class="shell" data-swipe-shell>
      <header class="appbar">
        <h1>${screenTitle()}</h1>
        <button class="icon-button compact" type="button" aria-label="Notificacoes">!</button>
      </header>

      <main class="page-track" data-swipe-track>
        ${
          state.tab === 'dashboard'
            ? `<div class="scope-switch" data-scope>
                <button class="${state.scope === 'PERSONAL' ? 'active' : ''}" type="button" data-value="PERSONAL">Pessoal</button>
                <button class="${state.scope === 'BUSINESS' ? 'active' : ''}" type="button" data-value="BUSINESS">Negocio</button>
              </div>
              <section class="grid dashboard-grid">
                ${balanceCard(`Saldo total`, totals.balance)}
                ${metricCard('Receitas', totals.income, 'income')}
                ${metricCard('Gastos', totals.expense, 'expense')}
              </section>`
            : ''
        }

        <section class="grid" id="view">${viewHtml()}</section>
      </main>

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
  document.querySelector('[data-scope]')?.addEventListener('click', (event) => {
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
      if (MAIN_TABS.includes(target)) {
        switchTab(target);
        return;
      }
      renderWithTransition(() => {
        state.tab = target;
      });
    });
  });

  document.querySelectorAll('[data-manage-section]').forEach((button) => {
    button.addEventListener('click', () => {
      renderWithTransition(() => {
        state.tab = 'more';
        state.manageSection = button.dataset.manageSection;
        state.fabOpen = false;
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

  document.querySelectorAll('[data-transaction-type]').forEach((control) => {
    control.addEventListener('change', () => {
      renderWithTransition(() => {
        state.quickType = control.value;
      });
    });
  });
}

function bindSwipeNavigation() {
  const shell = document.querySelector('[data-swipe-shell]');
  const track = document.querySelector('[data-swipe-track]');
  if (!shell || !track || !MAIN_TABS.includes(state.tab)) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let pointerId = null;
  let isTracking = false;
  let isHorizontal = false;

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

  shell.addEventListener('pointerdown', (event) => {
    if (state.sheetOpen || state.fabOpen) return;
    if (event.target.closest(interactiveSelector)) return;
    startX = event.clientX;
    startY = event.clientY;
    startTime = performance.now();
    pointerId = event.pointerId;
    isTracking = true;
    isHorizontal = false;
    shell.setPointerCapture?.(pointerId);
  });

  shell.addEventListener('pointermove', (event) => {
    if (!isTracking || event.pointerId !== pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!isHorizontal && Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
      isHorizontal = true;
      track.classList.add('is-swiping');
    }

    if (!isHorizontal && Math.abs(deltaY) > 12 && Math.abs(deltaY) > Math.abs(deltaX)) {
      isTracking = false;
      shell.releasePointerCapture?.(pointerId);
      return;
    }

    if (isHorizontal) {
      event.preventDefault();
      const currentIndex = MAIN_TABS.indexOf(state.tab);
      const isAtStart = currentIndex === 0 && deltaX > 0;
      const isAtEnd = currentIndex === MAIN_TABS.length - 1 && deltaX < 0;
      const resistance = isAtStart || isAtEnd ? 0.1 : 0.22;
      const offset = Math.max(-58, Math.min(58, deltaX * resistance));
      track.style.setProperty('--swipe-offset', `${offset}px`);
    }
  });

  shell.addEventListener('pointerup', (event) => {
    if (!isTracking || event.pointerId !== pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const elapsed = Math.max(1, performance.now() - startTime);
    const velocity = Math.abs(deltaX) / elapsed;
    isTracking = false;
    shell.releasePointerCapture?.(pointerId);
    track.classList.remove('is-swiping');
    track.style.removeProperty('--swipe-offset');

    const hasIntent = Math.abs(deltaX) > 54 || (Math.abs(deltaX) > 34 && velocity > 0.45);
    if (!hasIntent || Math.abs(deltaX) < Math.abs(deltaY) * 1.15) return;
    const currentIndex = MAIN_TABS.indexOf(state.tab);
    const targetIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const targetTab = MAIN_TABS[targetIndex];
    if (!targetTab) return;
    switchTab(targetTab);
  });

  shell.addEventListener('pointercancel', () => {
    isTracking = false;
    isHorizontal = false;
    track.classList.remove('is-swiping');
    track.style.removeProperty('--swipe-offset');
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
