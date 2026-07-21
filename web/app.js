import { api, loadData } from './api.js';
import {
  app,
  clearSession,
  saveCategoryKinds,
  saveOnboardingDismissed,
  saveOnboardingProfileDone,
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
import { businessOnboardingHtml } from './views/business-onboarding.js';

const MAIN_TABS = ['dashboard', 'transactions', 'reports', 'more'];
const GOOGLE_CLIENT_ID = window.ECONOAPP_CONFIG?.googleClientId || '';
let pendingGoogleCredential = '';
let googleInitAttempts = 0;

function screenTitle() {
  const titles = {
    dashboard: 'Resumo',
    transactions: 'Transações',
    reports: 'Análise',
    budget: 'Metas',
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
  if (location.hostname === 'localhost' && new URLSearchParams(location.search).has('loadingPreview')) {
    renderLoading();
    return;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (!state.accessToken) {
    renderAuth();
    return;
  }

  renderLoading();
  try {
    const result = await loadData();
    renderApp();
    if (result.warnings.length) {
      showToast('Algumas informações não carregaram. Você pode continuar usando o app.', 'warning');
    }
  } catch (error) {
    if (!state.accessToken) renderAuth(error.message);
    else renderLoadError(error.message);
  }
}

function renderLoadError(message) {
  app.innerHTML = `
    <section class="loading-shell" role="alert">
      <div class="loading-copy">
        <strong>Não foi possível carregar seus dados</strong>
        <span>${escapeHtml(message || 'Verifique sua conexão e tente novamente.')}</span>
      </div>
      <button class="primary-button" id="retry-load" type="button">Tentar novamente</button>
      <button class="secondary-button" id="logout-load" type="button">Sair da conta</button>
    </section>`;
  document.querySelector('#retry-load')?.addEventListener('click', bootstrap);
  document.querySelector('#logout-load')?.addEventListener('click', () => {
    clearSession();
    renderAuth();
  });
}

function renderLoading() {
  app.innerHTML = `
    <section class="loading-shell splash-loading" role="status" aria-live="polite" aria-label="Carregando o Din">
      <div class="splash-brand">
        <img src="./assets/din-logo.svg" alt="Din" />
        <p>Seu dinheiro, mais <strong>inteligente.</strong></p>
      </div>
      <div class="splash-mascot" aria-hidden="true">
        <img src="./assets/login-illustration.jpg" alt="" />
      </div>
      <div class="splash-progress">
        <span class="splash-spinner" aria-hidden="true"></span>
        <strong>Preparando sua vida financeira</strong>
        <span>Carregando saldos e insights...</span>
      </div>
    </section>`;
}

function renderAuth(initialError = '') {
  const resetToken = new URLSearchParams(location.search).get('token');
  app.innerHTML = `
    <section class="auth-shell" data-auth-shell data-auth-mode="login">
      <div class="welcome-panel">
        <div class="brand-row centered">
          <img class="din-logo" src="./assets/din-logo.svg" alt="Din" />
        </div>
        <h2 class="auth-title">Seu dinheiro,<br />mais <span>inteligente.</span></h2>
        <p class="auth-subtitle">O copiloto financeiro que aprende com você e ajuda a tomar decisões melhores todos os dias.</p>
      </div>

      <div class="card">
        <div class="auth-switch ${resetToken ? 'hidden' : ''}" data-auth-tabs>
          <button class="active" type="button" data-mode="login">Entrar</button>
          <button type="button" data-mode="register">Cadastrar</button>
        </div>
        <p class="error ${initialError ? '' : 'hidden'}" data-error>${escapeHtml(initialError)}</p>
        <form class="form" data-auth-form data-mode="${resetToken ? 'reset' : 'login'}">
          ${authFields(resetToken ? 'reset' : 'login')}
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
    bindAuthControls(form);
  });

  const authForm = document.querySelector('[data-auth-form]');
  authForm.addEventListener('submit', handleAuth);
  bindAuthControls(authForm);
  document.querySelector('[data-google-phone-form]')?.addEventListener('submit', handleGooglePhone);
  document.querySelector('[data-google-cancel]')?.addEventListener('click', cancelGooglePhone);
  initializeGoogleLogin();
}

function authFields(mode) {
  if (mode === 'forgot') {
    return `
      <div><strong>Recuperar senha</strong><p class="muted">Informe o e-mail cadastrado. Enviaremos um link válido por 30 minutos.</p></div>
      <label class="field">E-mail<input name="email" type="email" autocomplete="email" required /></label>
      <button class="button" type="submit">Enviar link</button>
      <button class="button secondary" type="button" data-auth-back>Voltar</button>`;
  }
  if (mode === 'reset') {
    return `
      <div><strong>Criar nova senha</strong><p class="muted">Use pelo menos 8 caracteres.</p></div>
      ${passwordField('Nova senha', 'new-password', 'password', 'Digite a nova senha')}
      ${passwordField('Confirmar nova senha', 'new-password', 'passwordConfirmation', 'Repita a nova senha')}
      <button class="button" type="submit">Salvar nova senha</button>`;
  }
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
    <button class="button secondary" type="button" data-forgot-password>Esqueci minha senha</button>
  `;
}

function bindAuthControls(form) {
  bindAuthPasswordToggle(form);
  form.querySelector('[data-forgot-password]')?.addEventListener('click', () => {
    form.dataset.mode = 'forgot';
    form.innerHTML = authFields('forgot');
    bindAuthControls(form);
  });
  form.querySelector('[data-auth-back]')?.addEventListener('click', () => {
    form.dataset.mode = 'login';
    form.innerHTML = authFields('login');
    bindAuthControls(form);
  });
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
    if (form.dataset.mode === 'forgot') {
      await client.forgotPassword({ email: data.email });
      form.innerHTML = '<div class="empty"><strong>Confira seu e-mail</strong><p>Se houver uma conta cadastrada, o link chegará em alguns minutos.</p><button class="button secondary" type="button" data-auth-back>Voltar</button></div>';
      bindAuthControls(form);
      return;
    }
    if (form.dataset.mode === 'reset') {
      if (data.password !== data.passwordConfirmation) throw new Error('As senhas não coincidem.');
      const token = new URLSearchParams(location.search).get('token');
      if (!token) throw new Error('Link de recuperação inválido.');
      await client.resetPassword({ token, password: data.password });
      history.replaceState({}, '', location.pathname);
      showToast('Senha alterada. Entre novamente.');
      renderAuth();
      return;
    }
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
  const accessExpired = Boolean(state.user?.paidUntil && new Date(state.user.paidUntil) < new Date());
  if ((state.user?.accessStatus && state.user.accessStatus !== 'ACTIVE') || accessExpired) {
    renderAccessPending();
    return;
  }
  const totals = scopedTotals();
  app.innerHTML = `
    <section class="shell" data-swipe-shell>
      <header class="appbar ${state.tab === 'dashboard' ? 'dashboard-appbar' : ''}">
        <div>
          <h1>${state.tab === 'dashboard' && state.user?.name ? `Olá, ${escapeHtml(state.user.name.split(' ')[0])}! <span aria-hidden="true">👋</span>` : screenTitle()}</h1>
          ${state.tab === 'dashboard' ? '<p>Aqui está o resumo da sua vida financeira.</p>' : ''}
        </div>
        ${state.tab === 'dashboard' ? '<img class="din-mark compact" src="./assets/din-mark.svg" alt="Din" />' : ''}
      </header>

      <main class="page-track" data-swipe-track>
        ${
          state.tab === 'dashboard'
            ? `<div class="scope-switch" data-scope>
                <button class="${state.scope === 'PERSONAL' ? 'active' : ''}" type="button" data-value="PERSONAL">Pessoal</button>
                <button class="${state.scope === 'BUSINESS' ? 'active' : ''}" type="button" data-value="BUSINESS">Negócio</button>
              </div>
              ${state.scope === 'PERSONAL' ? `<section class="grid dashboard-grid">
                ${balanceCard(`Saldo total`, totals.balance)}
                ${metricCard('Receitas', totals.income, 'income')}
                ${metricCard('Gastos', totals.expense, 'expense')}
              </section>` : ''}`
            : ''
        }

        <section class="grid" id="view">${viewHtml()}</section>
      </main>

      <nav class="tabs" data-tabs>
        ${tabButton('dashboard', 'Início')}
        ${tabButton('transactions', 'Transações')}
        <button class="fab nav-fab ${state.fabOpen ? 'open' : ''}" type="button" data-fab aria-label="Adicionar">+</button>
        ${tabButton('reports', 'Análise')}
        ${tabButton('more', 'Mais')}
      </nav>
      ${state.tab === 'assistant' ? assistantInputHtml() : ''}
      ${state.fabOpen ? fabMenu() : ''}
      ${state.sheetOpen ? transactionSheet() : ''}
      ${state.transactionSuccess ? transactionSuccessSheet() : ''}
      ${businessOnboardingHtml()}
    </section>
  `;

  bindShellEvents();
  bindViewEvents();
  bindBusinessOnboarding();
}

async function activateBusinessScope(options = {}) {
  try {
    state.businessOnboardingReturnScope = state.scope;
    const response = await api().businessSettings();
    const settings = response.data || {};
    state.businessSettings = settings;
    state.scope = 'BUSINESS';
    state.tab = options.tab || 'dashboard';
    state.manageSection = options.manageSection || '';
    state.fabOpen = false;
    saveScopes();
    if (!settings.onboardingCompleted) {
      state.businessOnboardingDraft = {
        businessType: settings.businessType || '',
        salesChannels: settings.salesChannels || [],
        recurringExpenses: settings.recurringExpenses || [],
        receivingMethods: settings.receivingMethods || [],
        revenueGoal: settings.revenueGoal ? Number(settings.revenueGoal).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
        reserveTaxes: Number(settings.taxRate || 0) > 0,
        taxRate: Number(settings.taxRate || 6).toLocaleString('pt-BR'),
      };
      state.businessOnboardingStep = 0;
      state.businessOnboardingOpen = true;
      renderApp();
      return;
    }
    await loadData();
    renderApp();
  } catch (error) {
    showToast(error.message, 'error');
    renderApp();
  }
}

function bindBusinessOnboarding() {
  const form = document.querySelector('[data-business-onboarding-form]');
  if (!form) return;
  document.querySelectorAll('[data-business-onboarding-cancel]').forEach((button) => button.addEventListener('click', () => {
    state.businessOnboardingOpen = false;
    state.businessOnboardingStep = 0;
    state.scope = state.businessOnboardingReturnScope || 'PERSONAL';
    if (state.scope !== 'BUSINESS') state.manageSection = '';
    saveScopes();
    renderApp();
  }));
  document.querySelector('[data-business-onboarding-back]')?.addEventListener('click', () => {
    state.businessOnboardingStep = Math.max(0, state.businessOnboardingStep - 1);
    renderApp();
  });
  form.addEventListener('change', (event) => {
    const input = event.target.closest('input');
    if (!input) return;
    if (input.type === 'radio') {
      form.querySelectorAll(`input[name="${input.name}"]`).forEach((item) => item.closest('.business-choice')?.classList.toggle('selected', item.checked));
    } else if (input.type === 'checkbox') {
      input.closest('.business-choice')?.classList.toggle('selected', input.checked);
    }
    if (input.name === 'reserveTaxes') document.querySelector('[data-business-tax-rate]')?.classList.toggle('hidden', input.value !== 'true');
  });
  form.addEventListener('submit', handleBusinessOnboardingSubmit);
}

async function handleBusinessOnboardingSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const step = form.dataset.step;
  const data = new FormData(form);
  const draft = state.businessOnboardingDraft;
  const error = form.querySelector('[data-business-onboarding-error]');
  const fail = (message) => {
    error.textContent = message;
    error.classList.remove('hidden');
  };
  if (step === 'businessType') {
    draft.businessType = data.get('businessType') || '';
    if (!draft.businessType) return fail('Selecione o tipo do seu negócio.');
  }
  if (step === 'salesChannels') {
    draft.salesChannels = data.getAll('salesChannels');
    if (!draft.salesChannels.length) return fail('Selecione ao menos um canal de venda.');
  }
  if (step === 'recurringExpenses') draft.recurringExpenses = data.getAll('recurringExpenses');
  if (step === 'receivingMethods') {
    draft.receivingMethods = data.getAll('receivingMethods');
    if (!draft.receivingMethods.length) return fail('Selecione ao menos uma forma de recebimento.');
  }
  if (step === 'revenueGoal') {
    draft.revenueGoal = data.get('revenueGoal') || '';
    if (parseAmount(draft.revenueGoal) <= 0) return fail('Informe uma meta mensal maior que zero.');
  }
  if (step === 'taxes') {
    draft.reserveTaxes = data.get('reserveTaxes') === 'true';
    draft.taxRate = data.get('taxRate') || '0';
    if (draft.reserveTaxes && parseAmount(draft.taxRate) <= 0) return fail('Informe o percentual que deseja reservar.');
  }
  if (state.businessOnboardingStep < 5) {
    state.businessOnboardingStep += 1;
    renderApp();
    return;
  }
  try {
    setFormBusy(form, true, 'Preparando seu negócio...');
    const response = await api().completeBusinessOnboarding({
      businessType: draft.businessType,
      salesChannels: draft.salesChannels,
      recurringExpenses: draft.recurringExpenses,
      receivingMethods: draft.receivingMethods,
      revenueGoal: parseAmount(draft.revenueGoal),
      reserveTaxes: draft.reserveTaxes,
      taxRate: draft.reserveTaxes ? parseAmount(draft.taxRate) : 0,
    });
    state.businessSettings = response.data;
    state.businessOnboardingOpen = false;
    state.onboardingProfileDone = true;
    saveOnboardingProfileDone();
    await loadData();
    renderApp();
    showToast('Seu negócio está pronto. O Din já adaptou categorias e relatórios.');
  } catch (submitError) {
    fail(submitError.message);
    setFormBusy(form, false);
  }
}

function renderAccessPending() {
  const suspended = state.user?.accessStatus === 'SUSPENDED';
  const expired = Boolean(state.user?.paidUntil && new Date(state.user.paidUntil) < new Date());
  app.innerHTML = `
    <main class="auth-shell">
      <section class="card" style="max-width:520px;margin:auto;text-align:center;padding:32px 24px">
        <img class="din-mark" src="./assets/din-mark.svg" alt="Din" />
          <span class="eyebrow">Acesso ${expired ? 'expirado' : suspended ? 'suspenso' : 'em análise'}</span>
          <h1>${expired ? 'Seu período de acesso terminou' : suspended ? 'Sua conta está temporariamente suspensa' : 'Seu cadastro foi recebido'}</h1>
          <p class="muted">${expired ? 'Renove o pagamento para continuar usando o app e o bot do Din.' : suspended ? 'Fale com o suporte para verificar o pagamento e reativar sua conta.' : 'Após a confirmação do pagamento, o administrador liberará seu acesso ao app e ao bot do Din.'}</p>
        <button class="button secondary" type="button" data-pending-logout>Sair da conta</button>
      </section>
    </main>`;
  document.querySelector('[data-pending-logout]')?.addEventListener('click', () => {
    clearSession();
    renderAuth();
  });
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
      if (button.dataset.value === 'BUSINESS') {
        activateBusinessScope({ tab: 'dashboard' });
        return;
      }
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
      if (button.dataset.actionType === 'DIN') {
        state.fabOpen = false;
        state.sheetOpen = false;
        state.transactionSuccess = null;
        switchTab('assistant');
        return;
      }
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
  document.querySelector('[data-export-account]')?.addEventListener('click', handlePrivacyExport);
  document.querySelector('[data-delete-account]')?.addEventListener('click', handlePrivacyAccountDelete);
  document.querySelector('[data-intelligence-preferences]')?.addEventListener('submit', handleIntelligencePreferences);
  document.querySelectorAll('[data-insight-action]').forEach((button) => {
    button.addEventListener('click', () => handleInsightAction(button.dataset.insightId, button.dataset.insightAction));
  });
  document.querySelector('[data-business-onboarding-edit]')?.addEventListener('click', () => {
    const settings = state.businessSettings || {};
    state.businessOnboardingReturnScope = 'BUSINESS';
    state.businessOnboardingDraft = {
      businessType: settings.businessType || '',
      salesChannels: settings.salesChannels || [],
      recurringExpenses: settings.recurringExpenses || [],
      receivingMethods: settings.receivingMethods || [],
      revenueGoal: settings.revenueGoal ? Number(settings.revenueGoal).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
      reserveTaxes: Number(settings.taxRate || 0) > 0,
      taxRate: Number(settings.taxRate || 6).toLocaleString('pt-BR'),
    };
    state.businessOnboardingStep = 0;
    state.businessOnboardingOpen = true;
    renderApp();
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
      const requestedSection = button.dataset.manageSection;
      if (requestedSection === 'business' && state.scope !== 'BUSINESS') {
        activateBusinessScope({ tab: 'more', manageSection: 'business' });
        return;
      }
      renderWithTransition(() => {
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
      if (button.dataset.manageSection === 'business') {
        loadData().then(() => renderApp()).catch((error) => showToast(error.message, 'error'));
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
      if (action === 'profile-personal' || action === 'profile-business') {
        state.onboardingProfileDone = true;
        saveOnboardingProfileDone();
        if (action === 'profile-business') {
          activateBusinessScope({ tab: 'dashboard' });
          return;
        }
        state.scope = 'PERSONAL';
        saveScopes();
        loadData()
          .then(() => renderApp())
          .catch((error) => showToast(error.message, 'error'));
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
      if (action === 'transaction-income') {
        renderWithTransition(() => {
          state.quickType = 'INCOME';
          state.fabOpen = false;
          state.sheetOpen = true;
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
  document.querySelector('[data-onboarding-account-form]')?.addEventListener('submit', handleOnboardingAccountSubmit);
  document.querySelector('[data-channel-form]')?.addEventListener('submit', handleChannelSubmit);
  document.querySelector('[data-business-entry-form]')?.addEventListener('submit', handleBusinessEntrySubmit);
  document.querySelector('[data-business-contact-form]')?.addEventListener('submit', handleBusinessContactSubmit);
  document.querySelector('[data-business-offering-form]')?.addEventListener('submit', handleBusinessOfferingSubmit);
  document.querySelectorAll('[data-business-contact-delete]').forEach((button) => {
    button.addEventListener('click', () => handleBusinessContactDelete(button));
  });
  document.querySelectorAll('[data-business-offering-delete]').forEach((button) => {
    button.addEventListener('click', () => handleBusinessOfferingDelete(button));
  });
  document.querySelector('[data-business-contact-select]')?.addEventListener('change', (event) => {
    const option = event.currentTarget.selectedOptions[0];
    const input = event.currentTarget.form?.querySelector('input[name="counterparty"]');
    if (input && option?.dataset.contactName) input.value = option.dataset.contactName;
  });
  document.querySelector('[data-business-tax-form]')?.addEventListener('submit', handleBusinessTaxSubmit);
  document.querySelectorAll('[data-business-cost-category]').forEach((select) => {
    select.addEventListener('change', () => handleBusinessCostTypeChange(select));
  });
  document.querySelectorAll('[data-business-settle]').forEach((button) => {
    button.addEventListener('click', () => handleBusinessEntrySettle(button.dataset.businessSettle));
  });
  document.querySelectorAll('[data-business-collect]').forEach((button) => {
    button.addEventListener('click', () => handleBusinessCollection(button.dataset.businessCollect));
  });
  document.querySelectorAll('[data-business-cancel]').forEach((button) => {
    button.addEventListener('click', () => handleBusinessEntryCancel(button.dataset.businessCancel));
  });
  document.querySelector('[data-wallet-form]')?.addEventListener('submit', handleWalletSubmit);
  document.querySelector('[data-card-form]')?.addEventListener('submit', handleCardSubmit);
  document.querySelectorAll('[data-account-delete]').forEach((button) => {
    button.addEventListener('click', () => handleAccountDelete(button));
  });
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

  document.querySelector('[data-import-csv-form]')?.addEventListener('submit', handleCsvImport);
  document.querySelector('[data-csv-file]')?.addEventListener('change', handleCsvPreview);
  document.querySelector('[data-export-csv]')?.addEventListener('click', handleCsvExport);
  document.querySelector('[data-recurring-form]')?.addEventListener('submit', handleRecurringSubmit);
  document.querySelector('[data-generate-recurring]')?.addEventListener('click', handleGenerateRecurring);
  document.querySelectorAll('[data-recurring-delete]').forEach((button) => {
    button.addEventListener('click', () => handleRecurringDelete(button.dataset.recurringDelete));
  });
  document.querySelectorAll('[data-recurring-edit]').forEach((button) => {
    button.addEventListener('click', () => startRecurringEdit(button.dataset.recurringEdit));
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

  document.querySelector('[data-clear-transaction-filters]')?.addEventListener('click', () => {
    state.transactionFilter = 'ALL';
    state.transactionSearch = '';
    renderApp();
  });

  document.querySelectorAll('[data-report-type]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.reportType === state.reportType) return;
      renderWithTransition(() => {
        state.reportType = button.dataset.reportType;
      });
    });
  });

  document.querySelectorAll('[data-report-period]').forEach((button) => {
    button.addEventListener('click', async () => {
      const offset = Number(button.dataset.reportPeriod);
      if (!Number.isInteger(offset) || offset === state.reportPeriodOffset || state.reportLoading) return;
      state.reportLoading = true;
      document.querySelectorAll('[data-report-period]').forEach((item) => { item.disabled = true; });
      try {
        const response = state.scope === 'BUSINESS' ? await api().businessReport(offset) : await api().report(offset);
        const direction = offset > state.reportPeriodOffset ? 'forward' : 'back';
        if (state.scope === 'BUSINESS') state.businessReport = response.data;
        else state.report = response.data;
        state.reportPeriodOffset = offset;
        state.reportLoading = false;
        renderWithTransition(() => {}, direction);
      } catch (error) {
        state.reportLoading = false;
        showToast(error.message || 'Não foi possível carregar o relatório deste período.', 'error');
        renderApp();
      }
    });
  });

  document.querySelectorAll('[data-business-report-export]').forEach((button) => {
    button.addEventListener('click', () => handleBusinessReportExport(button.dataset.businessReportExport));
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

async function handlePrivacyExport() {
  try {
    const response = await api().exportAccount();
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `din-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Cópia dos seus dados gerada.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handlePrivacyAccountDelete() {
  const confirmation = window.prompt('Esta ação é permanente. Digite EXCLUIR para confirmar:');
  if (confirmation !== 'EXCLUIR') return;
  const password = window.prompt('Digite sua senha atual. Contas criadas pelo Google podem deixar em branco:') || undefined;
  try {
    await api().deleteUserAccount({ confirmation: 'EXCLUIR', password });
    clearSession();
    renderAuth();
    showToast('Sua conta foi excluída.');
  } catch (error) {
    showToast(error.message, 'error');
  }
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
    activateBusinessScope({ tab: 'dashboard' });
    return;
  }

  if (action === 'wallet') {
    renderWithTransition(() => {
      state.tab = 'more';
      state.manageSection = 'accounts';
      state.manageAccountTab = 'wallets';
      state.manageModal = 'wallet';
      state.fabOpen = false;
    });
    return;
  }

  if (action === 'categories') {
    renderWithTransition(() => {
      state.tab = 'more';
      state.manageSection = 'categories';
      state.manageModal = '';
      state.fabOpen = false;
    });
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
    const actions = Array.isArray(response.data?.actions) ? response.data.actions.slice(0, 3) : [];
    state.assistantMessages = [...state.assistantMessages, { role: 'assistant', text: reply, actions }].slice(-12);
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


async function handleCsvImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const file = data.get('file');
  if (!(file instanceof File)) {
    showToast('Escolha um arquivo CSV para importar.', 'error');
    return;
  }

  state.importCsvLoading = true;
  state.importCsvSummary = null;
  renderApp();

  try {
    const csv = await file.text();
    const response = await api().importTransactionsCsv({
      csv,
      accountId: data.get('accountId') || undefined,
      categoryId: data.get('categoryId') || undefined,
      scope: state.scope,
    });
    state.importCsvSummary = response.data;
    await loadData();
    state.importCsvSummary = response.data;
    state.tab = 'transactions';
    renderApp();
    showToast(`${response.data.created} transacoes importadas.`);
  } catch (error) {
    showToast(error.message, 'error');
    state.importCsvLoading = false;
    renderApp();
    return;
  }
  state.importCsvLoading = false;
}

async function handleCsvExport() {
  state.exportCsvLoading = true;
  renderApp();
  try {
    const response = await api().exportTransactionsCsv();
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const scopeName = state.scope === 'BUSINESS' ? 'negocio' : 'pessoal';
    link.href = url;
    link.download = `econoapp-transacoes-${scopeName}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Backup CSV gerado.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.exportCsvLoading = false;
    renderApp();
  }
}

async function handleCsvPreview(event) {
  const file = event.currentTarget.files?.[0];
  const target = document.querySelector('[data-csv-preview]');
  if (!file || !target) return;
  const rows = parseCsvPreview(await file.text());
  target.innerHTML = rows.length
    ? `<strong>Prévia do arquivo</strong>${rows
        .map((row) => `<span>${row.map(escapeHtml).join(' · ')}</span>`)
        .join('')}`
    : '<p class="import-summary">Não encontramos linhas válidas neste arquivo.</p>';
}

function parseCsvPreview(csv) {
  return csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 6)
    .map((line) => line.split(line.includes(';') ? ';' : ',').map((cell) => cell.trim().replace(/^"|"$/g, '')));
}

async function handleRecurringSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const amount = parseAmount(data.amount);
  if (!amount || amount <= 0) {
    showToast('Informe um valor valido para a recorrencia.', 'error');
    return;
  }
  if (!data.categoryId) {
    showToast('Escolha uma categoria para a recorrencia.', 'error');
    return;
  }

  state.recurringLoading = true;
  state.recurringSummary = null;
  renderApp();

  try {
    const payload = {
      description: String(data.description || '').trim(),
      amount,
      type: data.type,
      scope: state.scope,
      categoryId: data.categoryId,
      accountId: data.accountId || undefined,
      frequency: data.frequency || 'MONTHLY',
      startDate: data.startDate,
      maxOccurrences: data.maxOccurrences ? Number(data.maxOccurrences) : undefined,
      generateFirst: data.generateFirst === 'on',
    };
    const wasEditing = Boolean(state.recurringEditingId);
    if (wasEditing) {
      delete payload.generateFirst;
      await api().updateRecurringTransaction(state.recurringEditingId, payload);
    } else {
      await api().createRecurringTransaction(payload);
    }
    await loadData();
    state.recurringEditingId = '';
    state.tab = 'more';
    showToast(wasEditing ? 'Recorrência atualizada.' : 'Recorrência criada.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.recurringLoading = false;
    renderApp();
  }
}

function startRecurringEdit(id) {
  const rule = state.recurringTransactions.find((item) => item.id === id);
  const form = document.querySelector('[data-recurring-form]');
  if (!rule || !form) return;
  state.recurringEditingId = id;
  form.elements.description.value = rule.description || '';
  form.elements.amount.value = String(Number(rule.amount || 0)).replace('.', ',');
  form.elements.type.value = rule.type;
  form.elements.categoryId.value = rule.categoryId;
  form.elements.frequency.value = rule.frequency;
  form.elements.startDate.value = String(rule.startDate || '').slice(0, 10);
  form.elements.accountId.value = rule.accountId || '';
  form.elements.maxOccurrences.value = rule.maxOccurrences || '';
  form.querySelector('[type="submit"]').textContent = 'Salvar alterações';
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleGenerateRecurring() {
  state.recurringLoading = true;
  state.recurringSummary = null;
  renderApp();
  try {
    const response = await api().generateRecurringTransactions();
    state.recurringSummary = response.data;
    await loadData();
    state.recurringSummary = response.data;
    showToast(`${response.data.created} lancamentos recorrentes gerados.`);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.recurringLoading = false;
    renderApp();
  }
}

async function handleRecurringDelete(id) {
  if (!id) return;
  const confirmed = window.confirm('Desativar esta recorrencia? Os lancamentos ja criados serao mantidos.');
  if (!confirmed) return;
  state.recurringLoading = true;
  renderApp();
  try {
    await api().deactivateRecurringTransaction(id);
    await loadData();
    showToast('Recorrencia desativada.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.recurringLoading = false;
    renderApp();
  }
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
      offeringId: data.offeringId || undefined,
      ...(data.offeringId ? { quantity: parseAmount(data.quantity || '1') } : {}),
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

async function handleIntelligencePreferences(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormBusy(form, true, 'Salvando preferências...');
  try {
    const response = await api().updateIntelligencePreferences({
      audioRepliesEnabled: data.get('audioRepliesEnabled') === 'on',
      proactiveAlertsEnabled: data.get('proactiveAlertsEnabled') === 'on',
      maxWeeklyAlerts: Number(data.get('maxWeeklyAlerts') || 3),
    });
    state.intelligencePreferences = response.data;
    renderApp();
    showToast('Preferências do Din atualizadas.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleInsightAction(id, action) {
  if (!id || !action) return;
  try {
    await api().actOnInsight(id, { action });
    const response = await api().insights(false);
    state.insights = response.data || [];
    renderApp();
    const labels = { CREATE_BUDGET: 'Orçamento criado.', REMIND_LATER: 'Vou lembrar depois.', IGNORE: 'Sugestão ignorada.' };
    showToast(labels[action] || 'Sugestão atualizada.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleBusinessReportExport(format) {
  if (format !== 'pdf' && format !== 'csv') return;
  try {
    const response = await api().exportBusinessReport(format);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `din-relatorio-empresarial-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`Relatório ${format.toUpperCase()} gerado.`);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleBusinessEntrySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Adicionando...');
  try {
    const response = await api().createBusinessEntry({
      type: data.type,
      title: String(data.title || '').trim(),
      counterparty: String(data.counterparty || '').trim(),
      ...(data.contactId ? { contactId: data.contactId } : {}),
      ...(data.offeringId ? { offeringId: data.offeringId, quantity: parseAmount(data.quantity || '1') } : {}),
      amount: parseAmount(data.amount),
      dueDate: data.dueDate,
      categoryId: data.categoryId,
      ...(data.accountId ? { accountId: data.accountId } : {}),
      ...(data.recurrenceFrequency ? { recurrenceFrequency: data.recurrenceFrequency } : {}),
      ...(data.recurrenceEndDate ? { recurrenceEndDate: data.recurrenceEndDate } : {}),
    });
    await loadData();
    renderApp();
    const generated = Number(response.data?.generated || 1);
    showToast(generated > 1 ? `${generated} contas recorrentes adicionadas.` : 'Conta adicionada à agenda.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleBusinessContactSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (!String(data.phone || '').trim() && !String(data.email || '').trim()) {
    showToast('Informe um telefone ou e-mail.', 'error');
    return;
  }
  setFormBusy(form, true, 'Adicionando...');
  try {
    await api().createBusinessContact({
      type: data.type,
      name: String(data.name || '').trim(),
      ...(String(data.phone || '').trim() ? { phone: String(data.phone).trim() } : {}),
      ...(String(data.email || '').trim() ? { email: String(data.email).trim() } : {}),
      ...(String(data.notes || '').trim() ? { notes: String(data.notes).trim() } : {}),
    });
    await loadData();
    state.manageSection = 'contacts';
    renderApp();
    showToast('Contato empresarial adicionado.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleBusinessContactDelete(button) {
  const id = button.dataset.businessContactDelete;
  const name = button.dataset.contactName || 'este contato';
  if (!id || !window.confirm(`Excluir ${name}? As movimentações antigas serão preservadas.`)) return;
  button.disabled = true;
  try {
    await api().deleteBusinessContact(id);
    await loadData();
    state.manageSection = 'contacts';
    renderApp();
    showToast('Contato excluído.');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

async function handleBusinessOfferingSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Adicionando...');
  try {
    await api().createBusinessOffering({
      type: data.type,
      name: String(data.name || '').trim(),
      estimatedUnitCost: parseAmount(data.estimatedUnitCost || '0'),
      ...(String(data.defaultPrice || '').trim() ? { defaultPrice: parseAmount(data.defaultPrice) } : {}),
    });
    await loadData();
    state.manageSection = 'offerings';
    renderApp();
    showToast('Produto ou serviço adicionado.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleBusinessOfferingDelete(button) {
  const id = button.dataset.businessOfferingDelete;
  const name = button.dataset.offeringName || 'este item';
  if (!id || !window.confirm(`Desativar ${name}? As vendas antigas continuarão nos relatórios.`)) return;
  button.disabled = true;
  try {
    await api().deleteBusinessOffering(id);
    await loadData();
    state.manageSection = 'offerings';
    renderApp();
    showToast('Item desativado.');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

async function handleBusinessTaxSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormBusy(form, true, 'Salvando...');
  try {
    await api().updateBusinessSettings({ taxRate: parseAmount(data.get('taxRate') || '0') });
    await loadData();
    renderApp();
    showToast('Provisão de impostos atualizada.');
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleBusinessCostTypeChange(select) {
  const categoryId = select.dataset.businessCostCategory;
  if (!categoryId) return;
  select.disabled = true;
  try {
    await api().updateCategory(categoryId, { businessCostType: select.value || null });
    await loadData();
    renderApp();
    showToast('Classificação empresarial atualizada.');
  } catch (error) {
    select.disabled = false;
    showToast(error.message, 'error');
  }
}

async function handleBusinessEntrySettle(id) {
  if (!id) return;
  try {
    await api().settleBusinessEntry(id);
    await loadData();
    renderApp();
    showToast('Conta liquidada e movimentação registrada.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleBusinessCollection(id) {
  if (!id || !window.confirm('Enviar agora uma cobrança educada para o WhatsApp cadastrado do cliente?')) return;
  try {
    await api().sendBusinessCollection(id);
    showToast('Cobrança adicionada à fila de envio.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleBusinessEntryCancel(id) {
  if (!id || !window.confirm('Cancelar esta conta planejada?')) return;
  try {
    await api().cancelBusinessEntry(id);
    await loadData();
    renderApp();
    showToast('Conta cancelada.');
  } catch (error) {
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

async function handleOnboardingAccountSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true, 'Salvando conta...');
  try {
    await api().createAccount({
      name: String(data.name).trim(),
      type: data.type,
      balance: parseAmount(data.balance || '0'),
      scope: state.scope,
    });
    await loadData();
    showToast('Conta inicial criada.');
    renderApp();
  } catch (error) {
    setFormBusy(form, false);
    showToast(error.message, 'error');
  }
}

async function handleAccountDelete(button) {
  const id = button.dataset.accountDelete;
  const name = button.dataset.accountName || 'esta conta';
  const kind = button.dataset.accountKind || 'conta';
  if (!id) return;

  const confirmed = window.confirm(
    `Excluir ${kind} "${name}"?\n\nOs lançamentos antigos serão mantidos, mas ficarão sem essa conta vinculada.`,
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    await api().deleteFinancialAccount(id);
    await loadData();
    renderApp();
    showToast(`${kind === 'carteira' ? 'Carteira' : 'Conta'} excluída.`);
  } catch (error) {
    button.disabled = false;
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
