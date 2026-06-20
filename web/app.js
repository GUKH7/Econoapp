import { api, loadData } from './api.js';
import {
  app,
  clearSession,
  saveCategoryKinds,
  saveOnboardingDismissed,
  savePaymentData,
  saveScopes,
  saveSession,
  state,
} from './state.js';
import { escapeHtml, formatCurrencyInput, parseAmount, transitionTo } from './utils.js';
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
  transactionListHtml,
  transactionSheet,
  transactionSuccessSheet,
  viewHtml,
} from './views.js';
import { icon } from './views/shared.js';

const MAIN_TABS = ['dashboard', 'transactions', 'reports', 'more'];
const GOOGLE_CLIENT_ID = window.ECONOAPP_CONFIG?.googleClientId || '';
let pendingGoogleCredential = '';
let googleInitAttempts = 0;

function screenTitle() {
  const titles = {
    dashboard: 'Resumo',
    transactions: 'Transações',
    reports: 'Relatórios',
    budget: 'Limites',
    assistant: 'Din',
    more: manageTitle(),
    launch: 'Lançamentos',
  };
  if (state.scope === 'BUSINESS' && state.tab === 'dashboard') return 'Negócio';
  return titles[state.tab] || 'Resumo';
}

function manageTitle() {
  const titles = {
    accounts: 'Contas e carteiras',
    cards: 'Cartões',
    categories: 'Categorias e canais',
    channels: 'Canais de venda',
    whatsapp: 'WhatsApp',
  };
  return titles[state.manageSection] || 'Mais';
}

function setError(message) {
  const target = document.querySelector('[data-error]');
  if (target) target.textContent = message || '';
  if (target) target.classList.toggle('hidden', !message);
}

let toastTimer;

function showToast(message, tone = 'success') {
  document.querySelector('[data-toast]')?.remove();
  clearTimeout(toastTimer);
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.dataset.toast = '';
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 180);
  }, tone === 'error' ? 5200 : 3200);
}

function setFormBusy(form, busy, label = 'Salvando...') {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.disabled = true;
    button.textContent = label;
    form.setAttribute('aria-busy', 'true');
    return;
  }
  button.disabled = false;
  button.textContent = button.dataset.idleLabel || button.textContent;
  form.removeAttribute('aria-busy');
}

function renderWithTransition(mutator, direction = 'forward') {
  transitionTo(() => {
    mutator();
    renderApp();
  }, direction, { native: false });
}

function transitionDirectionForTab(targetTab) {
  const currentIndex = MAIN_TABS.indexOf(state.tab);
  const targetIndex = MAIN_TABS.indexOf(targetTab);
  if (currentIndex < 0 || targetIndex < 0) return 'forward';
  return targetIndex >= currentIndex ? 'forward' : 'back';
}

function switchTab(targetTab) {
  if (targetTab === state.tab) {
    if (targetTab === 'more' && state.manageSection) {
      renderWithTransition(() => {
        state.manageSection = '';
        state.fabOpen = false;
        state.transactionSuccess = null;
      }, 'back');
    }
    return;
  }
  renderWithTransition(() => {
    state.tab = targetTab;
    if (targetTab === 'more') state.manageSection = '';
    state.fabOpen = false;
    state.transactionSuccess = null;
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

  renderLoading();
  try {
    await loadData();
    renderApp();
  } catch (error) {
    clearSession();
    renderAuth(error.message);
  }
}

function renderLoading() {
  app.innerHTML = `
    <section class="loading-shell" role="status" aria-live="polite">
      <div class="loading-copy">
        <strong>Carregando suas finanças</strong>
        <span>O servidor pode levar alguns segundos para iniciar.</span>
      </div>
      <div class="loading-skeleton wide"></div>
      <div class="loading-grid">
        <div class="loading-skeleton"></div>
        <div class="loading-skeleton"></div>
      </div>
      <div class="loading-skeleton tall"></div>
    </section>
  `;
}

function renderAuth(initialError = '') {
  app.innerHTML = `
    <section class="auth-shell" data-auth-shell data-auth-mode="login">
      <div class="welcome-panel">
        <div class="brand-row centered">
          <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
          <h1 class="wordmark">Econo<span>App</span></h1>
        </div>
        <h2 class="auth-title">Suas finanças pessoais e do seu negócio em um só lugar</h2>
        <img class="welcome-illustration" src="./assets/login-illustration.jpg" alt="" aria-hidden="true" />
        <p class="auth-subtitle">Separe pessoal e negócio, acompanhe entradas, gastos, canais e categorias em um painel claro.</p>
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
        ${
          GOOGLE_CLIENT_ID
            ? `<div class="auth-divider"><span>ou</span></div>
               <div class="google-auth">
                 <div class="google-button-host" data-google-button></div>
                 <form class="google-phone-form hidden" data-google-phone-form>
                   <p><strong>Falta só seu telefone</strong><span>Usaremos esse número para identificar você no chatbot do WhatsApp.</span></p>
                   <label class="field">Telefone<input name="phone" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999" required /></label>
                   <button class="button" type="submit">Concluir cadastro</button>
                   <button class="button secondary" type="button" data-google-cancel>Usar outra forma de acesso</button>
                 </form>
               </div>`
            : ''
        }
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
    document.querySelector('[data-auth-shell]').dataset.authMode = button.dataset.mode;
    form.innerHTML = authFields(button.dataset.mode);
    bindAuthPasswordToggle(form);
  });

  const authForm = document.querySelector('[data-auth-form]');
  authForm.addEventListener('submit', handleAuth);
  bindAuthPasswordToggle(authForm);
  document.querySelector('[data-google-phone-form]')?.addEventListener('submit', handleGooglePhone);
  document.querySelector('[data-google-cancel]')?.addEventListener('click', cancelGooglePhone);
  initializeGoogleLogin();
}

function authFields(mode) {
  if (mode === 'register') {
    return `
      <label class="field">Nome<input name="name" autocomplete="name" required /></label>
      <label class="field">Telefone<input name="phone" inputmode="tel" required /></label>
      <label class="field">Email<input name="email" type="email" autocomplete="email" /></label>
      ${passwordField('Senha', 'new-password', 'password', 'Crie uma senha')}
      <button class="button" type="submit">Criar conta</button>
    `;
  }

  return `
    <label class="field">Telefone ou email<input name="login" autocomplete="username" required /></label>
    ${passwordField('Senha', 'current-password', 'password', 'Digite sua senha')}
    <button class="button" type="submit">Entrar</button>
  `;
}

function passwordField(label, autocomplete, name, placeholder) {
  const minLengthAttr = autocomplete === 'new-password' ? 'minlength="8"' : '';
  return `
    <label class="field">${label}
      <span class="password-control">
        <input name="${name}" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}" ${minLengthAttr} required />
        <button type="button" data-password-toggle aria-label="Mostrar senha">ver</button>
      </span>
    </label>
  `;
}

function bindAuthPasswordToggle(form) {
  form.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.closest('.password-control')?.querySelector('input');
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      button.textContent = isHidden ? 'ocultar' : 'ver';
      button.setAttribute('aria-label', isHidden ? 'Ocultar senha' : 'Mostrar senha');
    });
  });
}

async function handleAuth(event) {
  event.preventDefault();
  setError('');
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const submitButton = form.querySelector('button[type="submit"]');
  const submitLabel = submitButton?.textContent || '';
  const slowServerTimer = setTimeout(() => {
    if (submitButton?.disabled) submitButton.textContent = 'Iniciando servidor...';
  }, 2500);
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = form.dataset.mode === 'register' ? 'Criando...' : 'Entrando...';
  }
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
  } finally {
    clearTimeout(slowServerTimer);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitLabel;
    }
  }
}

function initializeGoogleLogin() {
  const host = document.querySelector('[data-google-button]');
  if (!host || !GOOGLE_CLIENT_ID) return;
  if (host.dataset.googleRendered === 'true') return;
  if (!window.google?.accounts?.id) {
    if (!document.querySelector('[data-google-sdk]')) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleSdk = '';
      script.addEventListener('load', initializeGoogleLogin, { once: true });
      script.addEventListener(
        'error',
        () => setError('Não foi possível carregar o acesso com Google. Tente novamente.'),
        { once: true },
      );
      document.head.appendChild(script);
    }
    if (googleInitAttempts < 20) {
      googleInitAttempts += 1;
      setTimeout(initializeGoogleLogin, 250);
    }
    return;
  }

  googleInitAttempts = 0;
  host.dataset.googleRendered = 'true';
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    use_fedcm_for_prompt: true,
  });
  window.google.accounts.id.renderButton(host, {
    type: 'standard',
    shape: 'rectangular',
    theme: 'outline',
    text: 'continue_with',
    size: 'large',
    locale: 'pt-BR',
    width: Math.min(360, Math.max(250, Math.round(host.getBoundingClientRect().width))),
  });
}

async function handleGoogleCredential(response) {
  pendingGoogleCredential = response?.credential || '';
  if (!pendingGoogleCredential) {
    setError('Não foi possível receber a credencial do Google.');
    return;
  }
  await completeGoogleLogin();
}

async function handleGooglePhone(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  await completeGoogleLogin(String(data.phone || '').replace(/\D/g, ''), form);
}

async function completeGoogleLogin(phone, form) {
  setError('');
  if (!pendingGoogleCredential) {
    setError('Selecione sua conta Google novamente.');
    return;
  }

  if (form) setFormBusy(form, true, 'Concluindo...');
  try {
    const response = await api().googleLogin({
      credential: pendingGoogleCredential,
      ...(phone ? { phone } : {}),
    });
    if (response.data.requiresPhone) {
      document.querySelector('[data-auth-shell]').dataset.authStep = 'google-phone';
      document.querySelector('[data-auth-tabs]')?.classList.add('hidden');
      document.querySelector('[data-auth-form]')?.classList.add('hidden');
      document.querySelector('.auth-divider')?.classList.add('hidden');
      document.querySelector('[data-google-phone-form]')?.classList.remove('hidden');
      document.querySelector('[data-google-button]')?.classList.add('hidden');
      return;
    }
    pendingGoogleCredential = '';
    saveSession(response.data);
    renderLoading();
    await loadData();
    renderApp();
  } catch (error) {
    setError(error.message);
  } finally {
    if (form) setFormBusy(form, false);
  }
}

function cancelGooglePhone() {
  pendingGoogleCredential = '';
  const shell = document.querySelector('[data-auth-shell]');
  if (shell) delete shell.dataset.authStep;
  document.querySelector('[data-auth-tabs]')?.classList.remove('hidden');
  document.querySelector('[data-auth-form]')?.classList.remove('hidden');
  document.querySelector('.auth-divider')?.classList.remove('hidden');
  document.querySelector('[data-google-phone-form]')?.classList.add('hidden');
  document.querySelector('[data-google-button]')?.classList.remove('hidden');
}

function renderApp() {
  const totals = scopedTotals();
  app.innerHTML = `
    <section class="shell" data-swipe-shell>
      <header class="appbar">
        <h1>${screenTitle()}</h1>
      </header>

      <main class="page-track" data-swipe-track>
        ${
          state.tab === 'dashboard'
            ? `<div class="scope-switch" data-scope>
                <button class="${state.scope === 'PERSONAL' ? 'active' : ''}" type="button" data-value="PERSONAL">Pessoal</button>
                <button class="${state.scope === 'BUSINESS' ? 'active' : ''}" type="button" data-value="BUSINESS">Negócio</button>
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
        ${tabButton('dashboard', 'Início')}
        ${tabButton('transactions', 'Fluxo')}
        <button class="fab nav-fab ${state.fabOpen ? 'open' : ''}" type="button" data-fab aria-label="Adicionar">+</button>
        ${tabButton('reports', 'Relatórios')}
        ${tabButton('more', 'Mais')}
      </nav>
      ${state.tab === 'assistant' ? assistantInputHtml() : ''}
      ${state.fabOpen ? fabMenu() : ''}
      ${state.sheetOpen ? transactionSheet() : ''}
      ${state.transactionSuccess ? transactionSuccessSheet() : ''}
    </section>
  `;

  bindShellEvents();
  bindViewEvents();
}

function assistantInputHtml() {
  return `
    <form class="assistant-input" data-assistant-form>
      <input name="message" placeholder="Fale com o Din..." autocomplete="off" ${state.assistantLoading ? 'disabled' : ''} />
      <button type="submit" aria-label="Enviar mensagem" ${state.assistantLoading ? 'disabled' : ''}>${icon('chat')}</button>
    </form>
  `;
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
        .catch((error) => showToast(error.message, 'error'));
    }, 90);
  });

  document.querySelector('[data-tabs]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    switchTab(button.dataset.tab);
  });

  document.querySelector('[data-fab]')?.addEventListener('click', () => {
    state.fabOpen = !state.fabOpen;
    state.transactionSuccess = null;
    renderApp();
  });

  document.querySelector('[data-fab-close]')?.addEventListener('click', () => {
    state.fabOpen = false;
    renderApp();
  });

  document.querySelectorAll('[data-action-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.quickType = button.dataset.actionType;
      state.fabOpen = false;
      state.sheetOpen = true;
      state.transactionSuccess = null;
      renderApp();
    });
  });

  document.querySelectorAll('[data-sheet-close]').forEach((element) => {
    element.addEventListener('click', () => {
      state.sheetOpen = false;
      renderApp();
    });
  });

  document.querySelectorAll('[data-success-close]').forEach((element) => {
    element.addEventListener('click', () => {
      state.transactionSuccess = null;
      renderApp();
    });
  });

  document.querySelector('[data-success-flow]')?.addEventListener('click', () => {
    state.transactionSuccess = null;
    if (state.tab === 'transactions') {
      renderApp();
      return;
    }
    switchTab('transactions');
  });

  document.querySelector('[data-success-new]')?.addEventListener('click', () => {
    state.transactionSuccess = null;
    state.fabOpen = false;
    state.sheetOpen = true;
    renderApp();
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
        const requestedSection = button.dataset.manageSection;
        state.tab = 'more';
        state.manageSection = requestedSection === 'cards' ? 'accounts' : requestedSection;
        if (requestedSection === 'cards') state.manageAccountTab = 'cards';
        if (requestedSection === 'accounts' && !state.manageAccountTab) state.manageAccountTab = 'accounts';
        state.fabOpen = false;
        state.manageModal = '';
      });
      if (button.dataset.manageSection === 'whatsapp' && !state.whatsappStatus) {
        refreshWhatsappStatus();
      }
    });
  });

  document.querySelectorAll('[data-account-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      renderWithTransition(() => {
        state.manageAccountTab = button.dataset.accountTab;
        state.manageModal = '';
      });
    });
  });

  document.querySelectorAll('[data-manage-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      state.manageModal = button.dataset.manageModal;
      renderApp();
    });
  });

  document.querySelectorAll('[data-manage-modal-close]').forEach((element) => {
    element.addEventListener('click', () => {
      state.manageModal = '';
      renderApp();
    });
  });

  document.querySelector('[data-manage-back]')?.addEventListener('click', () => {
    renderWithTransition(() => {
      state.manageSection = '';
      state.manageModal = '';
      state.fabOpen = false;
    }, 'back');
  });

  document.querySelector('[data-onboarding-dismiss]')?.addEventListener('click', () => {
    renderWithTransition(() => {
      state.onboardingDismissed = true;
      saveOnboardingDismissed();
    });
  });

  document.querySelectorAll('[data-onboarding-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.onboardingAction;
      if (action === 'seed-categories') {
        handleSeedCategories();
        return;
      }
      if (action === 'accounts') {
        renderWithTransition(() => {
          state.tab = 'more';
          state.manageSection = 'accounts';
          state.fabOpen = false;
        });
        return;
      }
      if (action === 'transaction') {
        renderWithTransition(() => {
          state.quickType = 'EXPENSE';
          state.fabOpen = false;
          state.sheetOpen = true;
        });
      }
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
  document.querySelectorAll('[data-budget-delete]').forEach((button) => {
    button.addEventListener('click', () => handleBudgetDelete(button.dataset.budgetDelete));
  });
  document.querySelector('[data-whatsapp-refresh]')?.addEventListener('click', () => {
    refreshWhatsappStatus();
  });
  document.querySelector('[data-whatsapp-restart]')?.addEventListener('click', () => {
    restartWhatsapp();
  });
  document
    .querySelector('[data-whatsapp-message-form]')
    ?.addEventListener('submit', handleWhatsappMessageSubmit);

  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      state.categoryColor = button.dataset.color;
      document
        .querySelectorAll('[data-color]')
        .forEach((item) => item.classList.toggle('active', item.dataset.color === state.categoryColor));
    });
  });

  document.querySelectorAll('[data-transaction-type]').forEach((control) => {
    control.addEventListener('change', () => {
      renderWithTransition(() => {
        state.quickType = control.value;
      });
    });
  });

  document.querySelectorAll('[data-din-compose]').forEach((button) => {
    button.addEventListener('click', () => {
      const message = button.dataset.dinCompose || '';
      renderWithTransition(() => {
        state.sheetOpen = false;
        state.fabOpen = false;
        state.tab = 'assistant';
      });
      requestAnimationFrame(() => {
        const input = document.querySelector('[data-assistant-form] input[name="message"]');
        if (!input) return;
        input.value = message;
        input.focus();
      });
    });
  });

  document.querySelectorAll('input[name="amount"]').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = formatCurrencyInput(input.value);
    });
    input.addEventListener('focus', () => {
      if (!input.value.trim()) input.value = formatCurrencyInput('0');
      input.select();
    });
  });

  document.querySelectorAll('input[name="balance"], input[name="limit"], input[name="budget"]').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = formatCurrencyInput(input.value);
    });
    input.addEventListener('focus', () => {
      if (!input.value.trim()) input.value = formatCurrencyInput('0');
      input.select();
    });
  });

  document.querySelectorAll('[data-amount-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = button.closest('[data-transaction-form]');
      const input = form?.querySelector('input[name="amount"]');
      if (!input) return;
      input.value = formatCurrencyInput(`${button.dataset.amountPreset}00`);
      input.focus();
    });
  });

  document.querySelector('[data-transaction-search]')?.addEventListener('input', (event) => {
    state.transactionSearch = event.currentTarget.value;
    renderTransactionList();
  });

  document.querySelectorAll('[data-transaction-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.transactionFilter = button.dataset.transactionFilter;
      document
        .querySelectorAll('[data-transaction-filter]')
        .forEach((item) => item.classList.toggle('active', item === button));
      renderTransactionList();
    });
  });

  document.querySelectorAll('[data-report-type]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.reportType === state.reportType) return;
      renderWithTransition(() => {
        state.reportType = button.dataset.reportType;
      });
    });
  });

  document.querySelectorAll('[data-assistant-action]').forEach((button) => {
    button.addEventListener('click', () => {
      handleAssistantAction(button.dataset.assistantAction);
    });
  });

  document.querySelectorAll('[data-assistant-message]').forEach((button) => {
    button.addEventListener('click', () => {
      handleAssistantMessage(button.dataset.assistantMessage || '');
    });
  });

  document.querySelector('[data-assistant-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(new FormData(form).get('message') || '').trim();
    if (!message) return;
    form.reset();
    handleAssistantMessage(message);
  });
}

function handleAssistantAction(action) {
  if (action === 'expense' || action === 'income') {
    state.quickType = action === 'income' ? 'INCOME' : 'EXPENSE';
    state.sheetOpen = true;
    renderApp();
    return;
  }

  if (action === 'reports') {
    switchTab('reports');
    return;
  }

  if (action === 'budget') {
    renderWithTransition(() => {
      state.tab = 'budget';
      state.fabOpen = false;
    });
    return;
  }

  if (action === 'business') {
    renderWithTransition(() => {
      state.scope = 'BUSINESS';
      saveScopes();
      state.tab = 'dashboard';
      state.fabOpen = false;
    });
    loadData()
      .then(() => renderApp())
      .catch((error) => showToast(error.message, 'error'));
    return;
  }

  if (action === 'channels') {
    renderWithTransition(() => {
      state.tab = 'more';
      state.manageSection = 'channels';
      state.fabOpen = false;
    });
    return;
  }

  showToast('Din está pronto para ajudar.');
}

async function handleAssistantMessage(message) {
  state.assistantMessages = [...state.assistantMessages, { role: 'user', text: message }].slice(-12);
  state.assistantLoading = true;
  state.assistantError = '';
  renderApp();
  scrollAssistantToBottom();

  try {
    const response = await api().assistantMessage({ message });
    const reply = response.data?.reply || 'Entendi. Como quer continuar?';
    state.assistantMessages = [...state.assistantMessages, { role: 'assistant', text: reply }].slice(-12);
    state.assistantLoading = false;
    state.assistantError = '';
    await loadData();
    renderApp();
    scrollAssistantToBottom();
    return;
  } catch (error) {
    state.assistantLoading = false;
    state.assistantError = error.message;
    renderApp();
    scrollAssistantToBottom();
  }

  const normalized = message.toLowerCase();
  if (/\b(gasto|gastei|despesa|paguei|compra)\b/.test(normalized)) {
    handleAssistantAction('expense');
    return;
  }
  if (/\b(receita|ganhei|recebi|vendi|entrada)\b/.test(normalized)) {
    handleAssistantAction('income');
    return;
  }
  if (/\b(relat|gastei|gastos|despesas|categoria)\b/.test(normalized)) {
    handleAssistantAction('reports');
    return;
  }
  if (/\b(negocio|negócio|venda|vendas|faturamento)\b/.test(normalized)) {
    handleAssistantAction('business');
    return;
  }
  if (/\b(limite|orcamento|orçamento|meta)\b/.test(normalized)) {
    handleAssistantAction('budget');
    return;
  }
  showToast('Din entendeu. Use uma sugestão rápida para agir agora.');
}

function scrollAssistantToBottom() {
  if (state.tab !== 'assistant') return;
  requestAnimationFrame(() => {
    const thread = document.querySelector('.assistant-thread');
    thread?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  });
}

function renderTransactionList() {
  const list = document.querySelector('[data-transaction-list]');
  if (list) list.innerHTML = transactionListHtml();
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
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Salvando lançamento...');
  try {
    if (data.type === 'TRANSFER') {
      showToast('Transferências reais entram na próxima etapa do backend.', 'error');
      setFormBusy(form, false);
      return;
    }

    let categoryId = data.categoryId;
    let createdCategory = null;
    if (String(data.newCategoryName || '').trim()) {
      const category = await api().createCategory({
        name: String(data.newCategoryName).trim(),
        color: state.categoryColor,
      });
      createdCategory = category.data;
      categoryId = category.data.id;
      state.categoryKinds[categoryId] = data.type;
      saveCategoryKinds();
    }
    if (!categoryId) {
      showToast(
        data.type === 'INCOME'
          ? 'Escolha ou crie uma origem de receita.'
          : 'Escolha ou crie uma categoria de gasto.',
        'error',
      );
      setFormBusy(form, false);
      return;
    }

    const paymentTarget =
      data.type === 'EXPENSE' ? paymentTargetFromValue(data.paymentMethod) : { accountId: data.receiveAccount };
    const amount = parseAmount(data.amount);
    const selectedCategory = state.categories.find((category) => category.id === categoryId);
    const paymentMeta =
      data.type === 'EXPENSE'
        ? paymentMetaFromValue(data.paymentMethod)
        : paymentMetaFromValue(`account:${data.receiveAccount}`, 'RECEIVE');

    const response = await api().createTransaction({
      description: data.description,
      amount,
      type: data.type,
      source: 'MANUAL',
      scope: state.scope,
      categoryId,
      channelId: data.channelId || undefined,
      accountId: paymentTarget.accountId || undefined,
      creditCardId: paymentTarget.creditCardId || undefined,
      date: data.date || undefined,
    });
    if (data.type === 'EXPENSE' && data.paymentMethod) {
      state.paymentMeta[response.data.id] = paymentMeta;
    }
    if (data.type === 'INCOME' && data.receiveAccount) {
      state.paymentMeta[response.data.id] = paymentMeta;
    }
    saveScopes();
    savePaymentData();
    await loadData();
    state.sheetOpen = false;
    state.fabOpen = false;
    state.quickType = data.type;
    state.transactionSuccess = {
      id: response.data.id,
      type: data.type,
      description: response.data.description || data.description,
      amount,
      categoryName: response.data.category?.name || createdCategory?.name || selectedCategory?.name || '',
      paymentLabel: paymentMeta?.label || '',
      date: response.data.date || data.date,
    };
    renderApp();
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleCategorySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Criando categoria...');
  try {
    const category = await api().createCategory({ name: data.name, color: state.categoryColor });
    state.categoryKinds[category.data.id] = data.kind || 'EXPENSE';
    saveCategoryKinds();
    await loadData();
    renderApp();
    showToast('Categoria criada.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleSeedCategories() {
  const presets = [
    { name: 'Alimentação', color: '#22C55E', kind: 'EXPENSE' },
    { name: 'Moradia', color: '#3B82F6', kind: 'EXPENSE' },
    { name: 'Transporte', color: '#F59E0B', kind: 'EXPENSE' },
    { name: 'Saúde', color: '#EF4444', kind: 'EXPENSE' },
    { name: 'Lazer', color: '#8B5CF6', kind: 'EXPENSE' },
    { name: 'Salário', color: '#166534', kind: 'INCOME' },
    { name: 'Vendas', color: '#22C55E', kind: 'INCOME' },
  ];
  const existing = new Set(state.categories.map((category) => category.name.trim().toLowerCase()));
  const missing = presets.filter((category) => !existing.has(category.name.toLowerCase()));
  if (!missing.length) return;

  try {
    for (const item of missing) {
      const category = await api().createCategory({ name: item.name, color: item.color });
      state.categoryKinds[category.data.id] = item.kind;
    }
    saveCategoryKinds();
    await loadData();
    renderApp();
    showToast('Categorias iniciais criadas.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleChannelSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Criando canal...');
  try {
    await api().createChannel({
      name: data.name,
      feePercent: parseAmount(data.feePercent || '0'),
    });
    await loadData();
    renderApp();
    showToast('Canal de venda criado.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleWalletSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Criando conta...');
  try {
    await api().createAccount({
      name: String(data.name).trim(),
      type: data.type,
      balance: parseAmount(data.balance || '0'),
      scope: state.scope,
    });
    await loadData();
    state.manageModal = '';
    renderApp();
    showToast('Conta ou carteira criada.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleCardSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Criando cartão...');
  try {
    await api().createCard({
      name: String(data.name).trim(),
      limit: parseAmount(data.limit || '0'),
      scope: state.scope,
    });
    await loadData();
    state.manageModal = '';
    renderApp();
    showToast('Cartão criado.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleBudgetSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Salvando limite...');
  try {
    await api().upsertBudget({
      categoryId: data.categoryId,
      scope: state.scope,
      amount: parseAmount(data.budget),
    });
    localStorage.removeItem('econoapp.budgets');
    await loadData();
    renderApp();
    showToast('Limite atualizado.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleBudgetDelete(id) {
  if (!id) return;
  try {
    await api().deleteBudget(id);
    await loadData();
    renderApp();
    showToast('Limite removido.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function refreshWhatsappStatus() {
  state.whatsappLoading = true;
  state.whatsappError = '';
  renderApp();
  try {
    const response = await api().whatsappStatus();
    state.whatsappStatus = response.data;
  } catch (error) {
    state.whatsappError = error.message;
  } finally {
    state.whatsappLoading = false;
    renderApp();
  }
}

async function restartWhatsapp() {
  state.whatsappLoading = true;
  state.whatsappError = '';
  renderApp();
  try {
    const response = await api().whatsappRestart();
    state.whatsappStatus = response.data;
  } catch (error) {
    state.whatsappError = error.message;
  } finally {
    state.whatsappLoading = false;
    renderApp();
  }
}

async function handleWhatsappMessageSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Enviando...');
  try {
    await api().sendWhatsappMessage({
      phone: String(data.phone).replace(/\D/g, ''),
      message: String(data.message).trim(),
    });
    form.reset();
    setFormBusy(form, false);
    showToast('Mensagem enviada pelo WhatsApp.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

bootstrap();
