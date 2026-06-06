import { colors, dateFmt, money, state } from './state.js';
import { escapeHtml } from './utils.js';
import {
  paymentMetaForTransaction,
  scopedTotals,
  scopedTransactions,
  scopeLabel,
  totalsByCategory,
  transactionScope,
} from './finance.js';

const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date());
const currentMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

function icon(name) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3v-9.5Z"/></svg>',
    flow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3 1.4-1.4L22 8l-5.6 5.4L15 12l3-3H7V7Zm10 10H6l3 3-1.4 1.4L2 16l5.6-5.4L9 12l-3 3h11v2Z"/></svg>',
    reports: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V9h3v11H5Zm5 0V4h3v16h-3Zm5 0v-7h3v7h-3Z"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a10 10 0 1 1 10-10h-2a8 8 0 1 0-8 8v2Zm0-4a6 6 0 1 1 6-6h-2a4 4 0 1 0-4 4v2Zm0-4a2 2 0 1 1 2-2h-2v2Zm5.7 1.3-3.1-3.1 1.4-1.4 1.7 1.7 3.9-3.9L23 10l-5.3 5.3Z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5v-2Z"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm0 2v10h15v-3h-5a4 4 0 0 1 0-8h5V8H4Zm10 1a2 2 0 0 0 0 4h5V9h-5Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4v-4a3 3 0 0 1-2-2.8V7a3 3 0 0 1 3-3Zm3 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>',
    card: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm0 2v2h18V8H3Zm0 5v5h18v-5H3Z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11V4h7l11 11-7 7L3 11Zm5-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>',
    shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4h16l1 6a4 4 0 0 1-6 3.5 4 4 0 0 1-6 0A4 4 0 0 1 3 10l1-6Zm1 11h14v6H5v-6Z"/></svg>',
  };
  return icons[name] || icons.more;
}

export function metricCard(label, value, className = '') {
  return `
    <article class="mini-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value ${className}">${money.format(value)}</div>
    </article>
  `;
}

export function balanceCard(label, value) {
  return `
    <article class="balance-card">
      <div class="metric-label">${label}<span class="balance-eye">●</span></div>
      <div class="metric-value">${money.format(value)}</div>
      <div class="sparkline" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      <div class="month-title"><span>${currentMonth}</span><span>${scopedTransactions().length} lancamentos</span></div>
    </article>
  `;
}

export function tabButton(id, label) {
  const icons = {
    dashboard: icon('home'),
    transactions: icon('flow'),
    reports: icon('reports'),
    budget: icon('target'),
    more: icon('more'),
  };
  return `<button class="${state.tab === id ? 'active' : ''}" type="button" data-tab="${id}"><span class="tab-icon">${icons[id]}</span>${label}</button>`;
}

export function fabMenu() {
  return `
    <div class="fab-menu" data-fab-close></div>
    <div class="fab-actions">
      <button class="fab-action" type="button" data-action-type="INCOME"><span class="row-icon income-bg">${icon('plus')}</span><span><strong>Nova receita</strong><small>Entrada pessoal ou do negocio</small></span></button>
      <button class="fab-action" type="button" data-action-type="EXPENSE"><span class="row-icon expense-bg">${icon('minus')}</span><span><strong>Novo gasto</strong><small>Despesa, compra ou taxa</small></span></button>
    </div>
  `;
}

export function transactionSheet() {
  const type = state.quickType || 'EXPENSE';
  const isIncome = type === 'INCOME';
  return `
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="${isIncome ? 'Nova receita' : 'Novo gasto'}">
      <div class="sheet-handle"></div>
      <div class="panel-title">
        <h2>${isIncome ? 'Nova receita' : 'Novo gasto'}</h2>
        <button class="icon-button" type="button" data-sheet-close aria-label="Fechar">x</button>
      </div>
      ${transactionFormHtml(type, 'sheet')}
    </section>
  `;
}

export function viewHtml() {
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
    .map(
      (category) =>
        `<span class="chip"><span class="dot" style="background:${category.color}"></span>${escapeHtml(category.name)}</span>`,
    )
    .join('');

  return `
    <article class="assistant-card">
      <div class="assistant-icon">${icon('chat')}</div>
      <div>
        <strong>EconoAssistente</strong>
        <p>Seus dados ficam separados entre pessoal e negocio para decisoes mais claras.</p>
      </div>
    </article>
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
      <button class="active" type="button">${currentMonth}</button>
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
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);
  const walletOptions = scopedWallets
    .map(
      (wallet) =>
        `<option value="${wallet.id}">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} - ${escapeHtml(wallet.name)}</option>`,
    )
    .join('');
  const expensePaymentOptions = [
    ...scopedWallets.map(
      (wallet) =>
        `<option value="account:${wallet.id}">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} - ${escapeHtml(wallet.name)}</option>`,
    ),
    ...scopedCards.map((card) => `<option value="card:${card.id}">Cartao - ${escapeHtml(card.name)}</option>`),
  ].join('');

  return `
    <form class="form" data-transaction-form data-context="${context}">
      <div class="form-section">
      <label class="field">Tipo
        <select name="type" data-transaction-type>
          <option value="EXPENSE" ${type === 'EXPENSE' ? 'selected' : ''}>Gasto</option>
          <option value="INCOME" ${type === 'INCOME' ? 'selected' : ''}>Receita</option>
        </select>
      </label>
      <label class="field">Valor<input class="amount-input" name="amount" inputmode="decimal" required placeholder="R$ 0,00" /></label>
      </div>
      <div class="form-section">
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
      </div>
      <div class="form-section">
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
      </div>
      <button class="button" type="submit">Salvar lancamento</button>
    </form>
  `;
}

function manageView() {
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);
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
          ${scopedWallets.map((wallet) => `<div class="row"><div><div class="row-title">${escapeHtml(wallet.name)}</div><div class="row-meta">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} ${scopeLabel()} - ${money.format(Number(wallet.balance || 0))}</div></div></div>`).join('') || '<p class="empty">Cadastre bancos ou carteiras para este escopo.</p>'}
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
          ${scopedCards.map((card) => `<div class="row"><div><div class="row-title">${escapeHtml(card.name)}</div><div class="row-meta">Cartao ${scopeLabel()} - limite ${money.format(Number(card.limit || 0))}</div></div></div>`).join('') || '<p class="empty">Cadastre cartoes para registrar gastos no credito.</p>'}
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
          ${state.categories.map((category) => `<span class="chip"><span class="dot" style="background:${category.color}"></span>${escapeHtml(category.name)}${state.categoryKinds[category.id] === 'INCOME' ? ' - receita' : state.categoryKinds[category.id] === 'EXPENSE' ? ' - gasto' : ''}</span>`).join('')}
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
      <button class="active" type="button">${currentMonth}</button>
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
      <button class="active" type="button">${currentMonth}</button>
      <button type="button">Junho</button>
    </div>
    <article class="card">
      ${
        currentBudget
          ? `<div class="panel-title"><h2>Limite ${scopeLabel()}</h2><strong>${money.format(currentBudget)}</strong></div>
             <div class="budget-progress"><span style="width:${used}%"></span></div>
             <p class="muted">${money.format(totals.expense)} usados de ${money.format(currentBudget)}</p>`
          : emptyState('Nenhum limite definido', 'Defina um teto de gastos para acompanhar o mes.', 'O')
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
          <button class="menu-item" type="button" data-tab-jump="launch"><span class="tab-icon">+/-</span><span>Lancamentos</span><span>></span></button>
          <button class="menu-item" type="button" data-tab-jump="more-manage"><span class="tab-icon">${icon('tag')}</span><span>Categorias e canais</span><span>></span></button>
          <button class="menu-item" type="button" data-tab-jump="budget"><span class="tab-icon">${icon('target')}</span><span>Limites</span><span>></span></button>
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
  const payment = paymentMetaForTransaction(transaction);
  const iconText = transaction.type === 'EXPENSE' ? '-' : '+';
  const iconColor = transaction.type === 'EXPENSE' ? '#EF4444' : '#22C55E';
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
