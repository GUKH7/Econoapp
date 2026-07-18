import { api, clearSession, session } from './api.js';

const root = document.querySelector('#app');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const viewState = { section: 'users', search: '', status: '', me: null, overview: null, users: [], bot: null };

bootstrap();

async function bootstrap() {
  if (!session.active) return renderLogin();
  renderLoading();
  try {
    await loadAdmin();
    renderPanel();
  } catch (error) {
    clearSession();
    renderLogin(error.message);
  }
}

async function loadAdmin() {
  const me = await api.me();
  if (!me.data?.isWhatsappAdmin) throw new Error('Esta conta não possui acesso administrativo.');
  viewState.me = me.data;
  const [overview, users] = await Promise.all([
    api.overview(),
    api.users({ search: viewState.search, status: viewState.status }),
  ]);
  viewState.overview = overview.data;
  viewState.users = users.data || [];
}

function renderLoading() {
  root.innerHTML = `<main class="center-shell"><img class="loader-mark" src="./assets/din-mark.svg" alt="Din"/><strong>Preparando o Din Admin</strong><span>Carregando usuários e pagamentos...</span></main>`;
}

function renderLogin(error = '') {
  root.innerHTML = `
    <main class="login-page">
      <section class="login-brand">
        <div class="brand-lockup"><img class="brand-mark" src="./assets/din-mark.svg" alt="Din"/><strong>Din</strong><em>Admin</em></div>
        <h1>Controle o acesso ao Din em um só lugar.</h1>
        <p>Libere clientes após o pagamento, acompanhe vencimentos e mantenha o bot conectado.</p>
        <div class="login-points"><span>✓ Pagamentos manuais</span><span>✓ Gestão de usuários</span><span>✓ Número central do bot</span></div>
      </section>
      <section class="login-card">
        <div><span class="eyebrow">Área restrita</span><h2>Entrar no painel</h2><p>Use o login administrativo exclusivo do Din.</p></div>
        ${error ? `<div class="alert">${escapeHtml(error)}</div>` : ''}
        <form data-login-form>
          <label>Login<input name="login" autocomplete="username" value="aleta0129" required /></label>
          <label>Senha<input name="password" type="password" autocomplete="current-password" required /></label>
          <button class="primary" type="submit">Entrar</button>
        </form>
      </section>
    </main>`;
  root.querySelector('[data-login-form]')?.addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const data = new FormData(form);
  button.disabled = true;
  button.textContent = 'Entrando...';
  try {
    const response = await api.login({
      login: String(data.get('login') || '').trim(),
      password: String(data.get('password') || ''),
    });
    session.save(response.data);
    await bootstrap();
  } catch (error) {
    renderLogin(error.message);
  }
}

function renderPanel() {
  const firstName = viewState.me?.name?.split(' ')[0] || 'Admin';
  root.innerHTML = `
    <div class="admin-shell">
      <aside class="sidebar">
        <div class="brand-lockup compact"><img class="brand-mark" src="./assets/din-mark.svg" alt="Din"/><strong>Din</strong><em>Admin</em></div>
        <nav>
          ${navButton('users', 'Usuários', '◉')}
          ${navButton('bot', 'Bot WhatsApp', '◌')}
        </nav>
        <div class="admin-profile"><span>${escapeHtml(firstName.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(viewState.me.name)}</strong><small>Administrador</small></div></div>
        <button class="logout" type="button" data-logout>Sair</button>
      </aside>
      <main class="workspace">
        <header><div><span class="eyebrow">Operação Din</span><h1>${viewState.section === 'bot' ? 'Bot WhatsApp' : 'Usuários e pagamentos'}</h1><p>${viewState.section === 'bot' ? 'Conecte e monitore o número central que atende seus clientes.' : 'Olá, ' + escapeHtml(firstName) + '. Aqui está a situação da sua base.'}</p></div><button class="icon-button" data-refresh aria-label="Atualizar">↻</button></header>
        ${viewState.section === 'bot' ? botView() : usersView()}
      </main>
      <div data-modal-root></div>
      <div class="toast-region" aria-live="polite"></div>
    </div>`;
  bindPanel();
  if (viewState.section === 'bot' && !viewState.bot) void refreshBot();
}

function navButton(id, label, icon) {
  return `<button class="nav-item ${viewState.section === id ? 'active' : ''}" data-section="${id}"><span>${icon}</span>${label}</button>`;
}

function usersView() {
  const overview = viewState.overview || {};
  return `
    <section class="metrics">
      ${metric('Usuários', overview.totalUsers || 0, 'Base cadastrada')}
      ${metric('Aguardando', overview.pendingUsers || 0, 'Precisam de liberação', 'warning')}
      ${metric('Ativos', overview.activeUsers || 0, `${overview.expiredUsers || 0} vencidos`, 'success')}
      ${metric('Receita no mês', money.format(overview.monthlyRevenue || 0), `${overview.monthlyPayments || 0} pagamentos`, 'money')}
    </section>
    <section class="panel users-panel">
      <div class="panel-head"><div><span class="eyebrow">Clientes</span><h2>Controle de acesso</h2></div><div class="filters"><input data-search type="search" value="${escapeHtml(viewState.search)}" placeholder="Buscar nome, e-mail ou telefone"/><select data-status><option value="">Todos</option>${statusOption('PENDING','Aguardando')}${statusOption('ACTIVE','Ativos')}${statusOption('SUSPENDED','Suspensos')}</select></div></div>
      <div class="user-list">${viewState.users.length ? viewState.users.map(userRow).join('') : emptyUsers()}</div>
    </section>`;
}

function metric(label, value, note, tone = '') {
  return `<article class="metric ${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function statusOption(value, label) {
  return `<option value="${value}" ${viewState.status === value ? 'selected' : ''}>${label}</option>`;
}

function userRow(user) {
  const status = effectiveStatus(user);
  const lastPayment = user.lastPayment;
  return `<article class="user-row">
    <div class="user-identity"><span class="avatar">${escapeHtml(user.name.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email || user.phone)}</small><em>Desde ${formatDate(user.createdAt)}</em></div></div>
    <div class="user-status"><span class="badge ${status.tone}">${status.label}</span><small>${user.paidUntil ? `Até ${formatDate(user.paidUntil)}` : 'Sem validade registrada'}</small></div>
    <div class="user-payment"><strong>${lastPayment ? money.format(lastPayment.amount) : 'Sem pagamento'}</strong><small>${lastPayment ? formatDate(lastPayment.paidAt) : `${user._count?.transactions || 0} lançamentos`}</small></div>
    <div class="actions">
      <button class="primary small" data-user-action="payment" data-user-id="${user.id}">Registrar pagamento</button>
      ${user.accessStatus === 'SUSPENDED' ? `<button class="secondary small" data-user-action="activate" data-user-id="${user.id}">Reativar</button>` : `<button class="secondary small" data-user-action="suspend" data-user-id="${user.id}">Suspender</button>`}
      <button class="danger-link" data-user-action="delete" data-user-id="${user.id}">Excluir</button>
    </div>
  </article>`;
}

function effectiveStatus(user) {
  if (user.accessStatus === 'SUSPENDED') return { label: 'Suspenso', tone: 'danger' };
  if (user.accessStatus === 'PENDING') return { label: 'Aguardando', tone: 'warning' };
  if (user.isExpired) return { label: 'Vencido', tone: 'muted' };
  return { label: 'Ativo', tone: 'success' };
}

function emptyUsers() {
  return `<div class="empty"><strong>Nenhum usuário encontrado</strong><span>Ajuste a busca ou o filtro para visualizar outros cadastros.</span></div>`;
}

function botView() {
  const bot = viewState.bot;
  const connected = bot?.status === 'conectado';
  const qr = qrSource(bot?.qrcode);
  return `<section class="bot-grid">
    <article class="panel bot-main">
      <div class="panel-head"><div><span class="eyebrow">Número central</span><h2>Conexão do WhatsApp</h2></div><span class="badge ${connected ? 'success' : 'warning'}">${connected ? 'Conectado' : bot ? statusLabel(bot.status) : 'Verificando'}</span></div>
      <div class="qr-stage">${qr ? `<img src="${qr}" alt="QR Code para conectar o WhatsApp"/>` : `<div class="phone-visual"><span>◌</span><strong>${connected ? 'Bot online' : 'Aguardando QR Code'}</strong><small>${connected ? 'O número central está pronto para atender.' : 'Reinicie a conexão para gerar um novo código.'}</small></div>`}</div>
      <div class="bot-actions"><button class="primary" data-bot-restart>${connected ? 'Reconectar número' : 'Gerar QR Code'}</button><button class="secondary" data-bot-refresh>Atualizar estado</button></div>
    </article>
    <article class="panel bot-guide"><span class="eyebrow">Como conectar</span><h2>Use o celular do número oficial</h2><ol><li>Abra o WhatsApp no celular.</li><li>Acesse <strong>Aparelhos conectados</strong>.</li><li>Toque em <strong>Conectar aparelho</strong>.</li><li>Escaneie o QR Code exibido.</li></ol><div class="security-note"><strong>Conexão protegida</strong><span>Somente administradores podem visualizar ou reiniciar esta sessão.</span></div></article>
  </section>`;
}

function bindPanel() {
  root.querySelector('[data-logout]')?.addEventListener('click', () => { clearSession(); renderLogin(); });
  root.querySelector('[data-refresh]')?.addEventListener('click', refreshAll);
  root.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => {
    viewState.section = button.dataset.section;
    renderPanel();
  }));
  let searchTimer;
  root.querySelector('[data-search]')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { viewState.search = event.target.value.trim(); void refreshUsers(); }, 350);
  });
  root.querySelector('[data-status]')?.addEventListener('change', (event) => {
    viewState.status = event.target.value;
    void refreshUsers();
  });
  root.querySelectorAll('[data-user-action]').forEach((button) => button.addEventListener('click', () => openUserAction(button)));
  root.querySelector('[data-bot-refresh]')?.addEventListener('click', refreshBot);
  root.querySelector('[data-bot-restart]')?.addEventListener('click', restartBot);
}

async function refreshAll() {
  renderLoading();
  try { await loadAdmin(); renderPanel(); } catch (error) { renderPanel(); toast(error.message, 'error'); }
}

async function refreshUsers() {
  try {
    const [overview, users] = await Promise.all([api.overview(), api.users({ search: viewState.search, status: viewState.status })]);
    viewState.overview = overview.data;
    viewState.users = users.data || [];
    renderPanel();
  } catch (error) { toast(error.message, 'error'); }
}

function openUserAction(button) {
  const user = viewState.users.find((item) => item.id === button.dataset.userId);
  if (!user) return;
  const action = button.dataset.userAction;
  if (action === 'payment') return paymentModal(user);
  if (action === 'delete') return confirmationModal(user, 'Excluir permanentemente', 'Todos os dados financeiros deste usuário serão apagados. Esta ação não pode ser desfeita.', 'Excluir usuário', () => mutateUser(() => api.deleteUser(user.id), 'Usuário excluído.'));
  const status = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
  const title = status === 'SUSPENDED' ? 'Suspender acesso' : 'Reativar acesso';
  confirmationModal(user, title, status === 'SUSPENDED' ? 'O usuário deixará de acessar o app e o bot imediatamente.' : 'O usuário voltará a acessar o Din.', title, () => mutateUser(() => api.updateAccess(user.id, status), 'Acesso atualizado.'));
}

function paymentModal(user) {
  const defaultUntil = new Date();
  defaultUntil.setMonth(defaultUntil.getMonth() + 1);
  showModal(`<form class="modal" data-payment-form><button class="modal-close" type="button" data-modal-close>×</button><span class="eyebrow">Liberar usuário</span><h2>Registrar pagamento</h2><p>${escapeHtml(user.name)} será ativado imediatamente.</p><label>Valor recebido<input name="amount" inputmode="decimal" value="49,90" required /></label><label>Acesso válido até<input name="validUntil" type="date" value="${dateKey(defaultUntil)}" required /></label><label>Observação<textarea name="notes" rows="3" placeholder="Ex.: Mensalidade de julho"></textarea></label><div class="modal-actions"><button class="secondary" type="button" data-modal-close>Cancelar</button><button class="primary" type="submit">Confirmar e liberar</button></div></form>`);
  root.querySelector('[data-payment-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Number(String(data.get('amount')).replace(/\./g, '').replace(',', '.'));
    await mutateUser(() => api.recordPayment(user.id, { amount, validUntil: `${data.get('validUntil')}T23:59:59.999Z`, notes: String(data.get('notes') || '') }), 'Pagamento registrado e usuário liberado.');
  });
}

function confirmationModal(user, title, copy, actionLabel, onConfirm) {
  showModal(`<div class="modal"><button class="modal-close" type="button" data-modal-close>×</button><span class="eyebrow">${escapeHtml(user.name)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p><div class="modal-actions"><button class="secondary" type="button" data-modal-close>Cancelar</button><button class="primary ${title.includes('Excluir') ? 'danger-button' : ''}" type="button" data-confirm>${escapeHtml(actionLabel)}</button></div></div>`);
  root.querySelector('[data-confirm]')?.addEventListener('click', onConfirm);
}

function showModal(content) {
  const host = root.querySelector('[data-modal-root]');
  host.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true">${content}</div>`;
  host.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', closeModal));
}

function closeModal() { const host = root.querySelector('[data-modal-root]'); if (host) host.innerHTML = ''; }

async function mutateUser(operation, message) {
  try { await operation(); closeModal(); await refreshUsers(); toast(message); } catch (error) { toast(error.message, 'error'); }
}

async function refreshBot() {
  try { const response = await api.whatsappStatus(); viewState.bot = response.data; renderPanel(); } catch (error) { toast(error.message, 'error'); }
}

async function restartBot() {
  try { const response = await api.whatsappRestart(); viewState.bot = response.data; renderPanel(); toast('Conexão reiniciada. Escaneie o QR Code quando aparecer.'); } catch (error) { toast(error.message, 'error'); }
}

function qrSource(value) {
  if (!value) return '';
  if (value.startsWith('data:image/') || value.startsWith('https://')) return value;
  return `data:image/png;base64,${value}`;
}
function statusLabel(status) { return ({ aguardando_qr: 'Aguardando QR', iniciando: 'Iniciando', desconectado: 'Desconectado', erro: 'Erro' })[status] || 'Desconectado'; }
function formatDate(value) { if (!value) return '—'; return date.format(new Date(value)); }
function dateKey(value) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function toast(message, tone = 'success') { const host = root.querySelector('.toast-region'); if (!host) return; host.innerHTML = `<div class="toast ${tone}">${escapeHtml(message)}</div>`; setTimeout(() => { if (host) host.innerHTML = ''; }, 4200); }
