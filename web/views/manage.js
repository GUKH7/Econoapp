import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTotals, scopeLabel } from '../finance.js';
import { currentMonth, emptyState, icon } from './shared.js';

export function budgetView() {
  const key = state.scope;
  const currentBudget = Number(state.budgets[key] || 0);
  const totals = scopedTotals();
  const used = currentBudget > 0 ? Math.min(100, (totals.expense / currentBudget) * 100) : 0;
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
             <p class="muted">${money.format(totals.expense)} usados de ${money.format(currentBudget)}</p>`
          : emptyState('Nenhum limite definido', 'Defina um teto de gastos para acompanhar o mês.', 'O')
      }
      <form class="form" data-budget-form style="margin-top:18px">
        <label class="field">Novo limite<input name="budget" inputmode="decimal" placeholder="0,00" /></label>
        <button class="button" type="submit">Definir limite</button>
      </form>
    </article>
  `;
}

export function moreView() {
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
          <button class="menu-item" type="button" data-tab-jump="launch"><span class="tab-icon">+/-</span><span>Lançamentos</span><span>></span></button>
          <button class="menu-item" type="button" data-manage-section="accounts"><span class="tab-icon">${icon('wallet')}</span><span>Contas e cartões</span><span>></span></button>
          <button class="menu-item" type="button" data-manage-section="categories"><span class="tab-icon">${icon('tag')}</span><span>Categorias e canais</span><span>></span></button>
          <button class="menu-item" type="button" data-tab-jump="budget"><span class="tab-icon">${icon('target')}</span><span>Limites</span><span>></span></button>
        </div>
      </article>
      ${manageView()}
    </div>
  `;
}

export function manageView() {
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);
  const section = state.manageSection || 'accounts';
  const sections = [
    { id: 'accounts', label: 'Contas', meta: `${scopedWallets.length} cadastradas`, icon: icon('wallet') },
    { id: 'cards', label: 'Cartoes', meta: `${scopedCards.length} cadastrados`, icon: icon('card') },
    { id: 'categories', label: 'Categorias', meta: `${state.categories.length} itens`, icon: icon('tag') },
    { id: 'channels', label: 'Canais', meta: `${state.channels.length} meios`, icon: icon('shop') },
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
          <button class="button" type="submit">Criar conta</button>
        </form>
        <div style="margin-top:14px">
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
          <button class="button" type="submit">Criar cartão</button>
        </form>
        <div style="margin-top:14px">
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
        <div class="chip-list" style="margin-top:14px">
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
        <div style="margin-top:14px">
          ${state.channels.map((channel) => `<div class="row"><div><div class="row-title">${escapeHtml(channel.name)}</div><div class="row-meta">Taxa ${Number(channel.feePercent).toFixed(2)}%</div></div></div>`).join('') || '<p class="empty">Cadastre canais para separar vendas do negócio.</p>'}
        </div>
      </article>
  `;

  const panels = {
    accounts: accountsPanel,
    cards: cardsPanel,
    categories: categoriesPanel,
    channels: channelsPanel,
  };

  return `
    <section class="manage-shell">
      <div class="manage-grid">${nav}</div>
      ${panels[section] || accountsPanel}
    </section>
  `;
}
