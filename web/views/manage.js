import { colors, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopeLabel } from '../finance.js';
import { currentMonth, emptyState, icon } from './shared.js';

export function budgetView() {
  const key = state.scope;
  const currentBudget = Number(state.budgets[key] || 0);
  const spent = Number(state.budgetSummary?.totalSpent || 0);
  const used = currentBudget > 0 ? Math.min(100, (spent / currentBudget) * 100) : 0;
  const categoryOptions = state.categories
    .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
    .join('');
  const budgetRows = state.categoryBudgets
    .map(
      (budget) => `
        <div class="row">
          <span class="category-dot" style="background:${escapeHtml(budget.categoryColor || '#22C55E')}"></span>
          <div class="row-main">
            <div class="row-title">${escapeHtml(budget.categoryName)}</div>
            <div class="row-meta">${money.format(Number(budget.spent || 0))} de ${money.format(Number(budget.amount || 0))} - ${Number(budget.percentage || 0)}%</div>
            <div class="budget-progress"><span style="width:${Math.min(100, Number(budget.percentage || 0))}%"></span></div>
          </div>
          <button class="button secondary compact-action" type="button" data-budget-delete="${budget.id}">Remover</button>
        </div>
      `,
    )
    .join('');
  return `
    <div class="period-switch">
      <button type="button">Abril</button>
      <button class="active" type="button">${currentMonth}</button>
      <button type="button">Junho</button>
    </div>
    <article class="card">
      ${
        currentBudget
          ? `<div class="panel-title"><h2>Limite ${scopeLabel()}</h2><strong>${money.format(currentBudget)}</strong></div>
             <div class="budget-progress"><span style="width:${used}%"></span></div>
             <p class="muted">${money.format(spent)} usados de ${money.format(currentBudget)}</p>
             <div class="menu-list budget-list">${budgetRows}</div>`
          : emptyState('Nenhum limite definido', 'Defina um teto de gastos para acompanhar o mês.', 'O')
      }
      <form class="form" data-budget-form style="margin-top:18px">
        <label class="field">Categoria
          <select name="categoryId" required>
            <option value="">Selecione uma categoria</option>
            ${categoryOptions}
          </select>
        </label>
        <label class="field">Limite mensal<input name="budget" inputmode="decimal" placeholder="0,00" required /></label>
        <button class="button" type="submit">Definir limite</button>
      </form>
    </article>
  `;
}

export function moreView() {
  if (state.manageSection) return manageView();

  return `
    <section class="more-shell">
      <article class="profile-card">
        <div class="profile-avatar">${escapeHtml((state.user?.name || 'U').slice(0, 1).toUpperCase())}</div>
        <div>
          <h2>${escapeHtml(state.user?.name || 'Usuário')}</h2>
          <p>${escapeHtml(state.user?.email || state.user?.phone || '')}</p>
        </div>
      </article>
      <article class="card">
        <div class="panel-title"><h2>Gerenciar</h2></div>
        <div class="menu-list">
          <button class="menu-item" type="button" data-tab-jump="launch"><span class="tab-icon">+/-</span><span>Lançamentos</span><span>›</span></button>
          <button class="menu-item" type="button" data-manage-section="accounts"><span class="tab-icon">${icon('wallet')}</span><span>Contas e carteiras</span><span>›</span></button>
          <button class="menu-item" type="button" data-manage-section="cards"><span class="tab-icon">${icon('card')}</span><span>Cartões de crédito</span><span>›</span></button>
          <button class="menu-item" type="button" data-manage-section="categories"><span class="tab-icon">${icon('tag')}</span><span>Categorias e canais</span><span>›</span></button>
          <button class="menu-item" type="button" data-tab-jump="budget"><span class="tab-icon">${icon('target')}</span><span>Limites e metas</span><span>›</span></button>
          ${
            state.user?.isWhatsappAdmin
              ? `<button class="menu-item" type="button" data-manage-section="whatsapp"><span class="tab-icon">${icon('chat')}</span><span>WhatsApp</span><span>›</span></button>`
              : ''
          }
        </div>
      </article>
      <button class="button danger" type="button" data-logout>Sair da conta</button>
    </section>
  `;
}

export function manageView() {
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);
  const section = state.manageSection || 'accounts';
  const sections = [
    { id: 'accounts', label: 'Contas', meta: `${scopedWallets.length} cadastradas`, icon: icon('wallet') },
    { id: 'cards', label: 'Cartões', meta: `${scopedCards.length} cadastrados`, icon: icon('card') },
    { id: 'categories', label: 'Categorias', meta: `${state.categories.length} itens`, icon: icon('tag') },
    { id: 'channels', label: 'Canais', meta: `${state.channels.length} meios`, icon: icon('shop') },
    ...(state.user?.isWhatsappAdmin
      ? [{ id: 'whatsapp', label: 'WhatsApp', meta: whatsappStatusLabel(), icon: icon('chat') }]
      : []),
  ];
  const nav = sections
    .map(
      (item) => `
        <button class="manage-pill ${section === item.id ? 'active' : ''}" type="button" data-manage-section="${item.id}">
          <span class="tab-icon">${item.icon}</span>
          <span><strong>${item.label}</strong><small>${item.meta}</small></span>
        </button>
      `,
    )
    .join('');

  const accountsPanel = `
    <article class="card manage-panel">
      <div class="panel-title"><h2>Bancos e carteiras</h2></div>
      <div class="total-strip">
        <span>Saldo total</span>
        <strong>${money.format(scopedWallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0))}</strong>
      </div>
      <form class="form" data-wallet-form>
        <label class="field">Nome<input name="name" required placeholder="Ex: Nubank, Inter, Dinheiro" /></label>
        <label class="field">Tipo
          <select name="type">
            <option value="BANK">Banco</option>
            <option value="WALLET">Carteira</option>
          </select>
        </label>
        <label class="field">Saldo inicial<input name="balance" inputmode="decimal" placeholder="0,00" /></label>
        <button class="button" type="submit">Salvar conta</button>
      </form>
      <div class="surface-list">
        ${scopedWallets.map((wallet) => `<div class="row"><div><div class="row-title">${escapeHtml(wallet.name)}</div><div class="row-meta">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} ${scopeLabel()} - ${money.format(Number(wallet.balance || 0))}</div></div></div>`).join('') || '<p class="empty">Cadastre bancos ou carteiras para este escopo.</p>'}
      </div>
    </article>
  `;

  const cardsPanel = `
    <article class="card manage-panel">
      <div class="panel-title"><h2>Cartões de crédito</h2></div>
      <div class="credit-preview">
        <span>EconoApp</span>
        <strong>**** 1234</strong>
        <small>Crédito</small>
      </div>
      <form class="form" data-card-form>
        <label class="field">Nome<input name="name" required placeholder="Ex: Nubank crédito, Inter Black" /></label>
        <label class="field">Limite<input name="limit" inputmode="decimal" placeholder="0,00" /></label>
        <button class="button" type="submit">Salvar cartão</button>
      </form>
      <div class="surface-list">
        ${scopedCards.map((card) => `<div class="row"><div><div class="row-title">${escapeHtml(card.name)}</div><div class="row-meta">Cartão ${scopeLabel()} - limite ${money.format(Number(card.limit || 0))}</div></div></div>`).join('') || '<p class="empty">Cadastre cartões para registrar gastos no crédito.</p>'}
      </div>
    </article>
  `;

  const categoriesPanel = `
    <article class="card manage-panel">
      <div class="panel-title"><h2>Categorias</h2></div>
      <form class="form" data-category-form>
        <label class="field">Nome<input name="name" required placeholder="Ex: Alimentação, Moradia, Taxas" /></label>
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
      <div class="chip-list surface-list">
        ${state.categories.map((category) => `<span class="chip"><span class="dot" style="background:${category.color}"></span>${escapeHtml(category.name)}${state.categoryKinds[category.id] === 'INCOME' ? ' - receita' : state.categoryKinds[category.id] === 'EXPENSE' ? ' - gasto' : ''}</span>`).join('')}
      </div>
    </article>
  `;

  const channelsPanel = `
    <article class="card manage-panel">
      <div class="panel-title"><h2>Canais de venda e meios</h2></div>
      <form class="form" data-channel-form>
        <label class="field">Nome<input name="name" required placeholder="Ex: Shopee, Mercado Livre, Pix Loja" /></label>
        <label class="field">Taxa (%)<input name="feePercent" inputmode="decimal" value="0" /></label>
        <button class="button" type="submit">Criar canal</button>
      </form>
      <div class="surface-list">
        ${state.channels.map((channel) => `<div class="row"><div><div class="row-title">${escapeHtml(channel.name)}</div><div class="row-meta">Taxa ${Number(channel.feePercent).toFixed(2)}%</div></div></div>`).join('') || '<p class="empty">Cadastre canais para separar vendas do negócio.</p>'}
      </div>
    </article>
  `;

  const whatsapp = state.whatsappStatus;
  const qrCode = whatsapp?.status === 'aguardando_qr' && whatsapp.qrcode ? whatsapp.qrcode : '';
  const whatsappPanel = `
    <article class="card manage-panel">
      <div class="panel-title">
        <h2>WhatsApp</h2>
        <span class="status-badge ${whatsapp?.status === 'conectado' ? 'connected' : ''}">${escapeHtml(whatsappStatusLabel())}</span>
      </div>
      <div class="whatsapp-status">
        ${
          qrCode
            ? `<img class="whatsapp-qr" src="${escapeHtml(qrCode)}" alt="QR Code para conectar o WhatsApp" />`
            : `<div class="whatsapp-placeholder">${state.whatsappLoading ? 'Carregando...' : whatsapp?.status === 'conectado' ? 'Conectado' : 'Sem QR Code disponível'}</div>`
        }
        <p class="row-meta">${state.whatsappError ? escapeHtml(state.whatsappError) : whatsappHelpText()}</p>
      </div>
      <div class="actions-row">
        <button class="button secondary" type="button" data-whatsapp-refresh>${state.whatsappLoading ? 'Atualizando...' : 'Atualizar status'}</button>
        <button class="button" type="button" data-whatsapp-restart>Reiniciar conexão</button>
      </div>
      <form class="form" data-whatsapp-message-form style="margin-top:16px">
        <label class="field">Telefone com DDI<input name="phone" inputmode="tel" placeholder="5511999999999" required /></label>
        <label class="field">Mensagem<textarea name="message" rows="3" placeholder="Mensagem de teste" required></textarea></label>
        <button class="button" type="submit" ${whatsapp?.status === 'conectado' ? '' : 'disabled'}>Enviar mensagem</button>
      </form>
    </article>
  `;

  const panels = {
    accounts: accountsPanel,
    cards: cardsPanel,
    categories: categoriesPanel,
    channels: channelsPanel,
    whatsapp: whatsappPanel,
  };

  return `
    <section class="manage-shell">
      <button class="back-link" type="button" data-manage-back>‹ Voltar</button>
      <div class="manage-grid">${nav}</div>
      ${state.user?.isWhatsappAdmin || section !== 'whatsapp' ? panels[section] || accountsPanel : accountsPanel}
    </section>
  `;
}

function whatsappStatusLabel() {
  const status = state.whatsappStatus?.status;
  const labels = {
    aguardando_qr: 'Aguardando QR',
    conectado: 'Conectado',
    iniciando: 'Iniciando',
    reconectando: 'Reconectando',
  };
  return labels[status] || 'Não consultado';
}

function whatsappHelpText() {
  const status = state.whatsappStatus?.status;
  if (status === 'aguardando_qr') return 'Escaneie o QR Code no WhatsApp para conectar.';
  if (status === 'conectado') return 'A API WhatsApp está pronta para enviar mensagens.';
  if (status === 'iniciando' || status === 'reconectando') return 'Aguarde alguns instantes e atualize o status.';
  return 'Consulte o status para verificar a conexão com a API WhatsApp.';
}
