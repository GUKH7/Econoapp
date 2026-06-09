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
const previousMonthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
  new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
);
const previousMonth = previousMonthLabel.charAt(0).toUpperCase() + previousMonthLabel.slice(1);
const nextMonthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
  new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
);
const nextMonth = nextMonthLabel.charAt(0).toUpperCase() + nextMonthLabel.slice(1);

function transactionValue(transaction) {
  return Number(transaction.netAmount || transaction.amount || 0);
}

function transactionMonthKey(transaction) {
  const date = new Date(transaction.date);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthKey(offset = 0) {
  const date = new Date();
  date.setMonth(date.getMonth() + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function totalsForTransactions(transactions) {
  return transactions.reduce(
    (acc, transaction) => {
      const value = transactionValue(transaction);
      if (transaction.type === 'INCOME') acc.income += value;
      if (transaction.type === 'EXPENSE') acc.expense += value;
      acc.balance = acc.income - acc.expense;
      return acc;
    },
    { income: 0, expense: 0, balance: 0 },
  );
}

function scopedTransactionsForMonth(offset = 0) {
  const key = monthKey(offset);
  return scopedTransactions().filter((transaction) => transactionMonthKey(transaction) === key);
}

function totalsByCategoryForTransactions(type, transactions) {
  const byId = new Map(state.categories.map((category) => [category.id, { ...category, total: 0 }]));
  transactions
    .filter((transaction) => transaction.type === type)
    .forEach((transaction) => {
      const category = byId.get(transaction.categoryId);
      if (category) category.total += transactionValue(transaction);
    });
  return [...byId.values()].filter((category) => category.total > 0);
}

function percentChange(current, previous) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function changeText(current, previous, kind = 'neutral') {
  if (previous <= 0 && current > 0) return 'Sem base no mes anterior';
  const change = percentChange(current, previous);
  if (current === previous) return 'Estavel vs mes anterior';
  const direction = change > 0 ? 'acima' : 'abaixo';
  const prefix = kind === 'expense' && change > 0 ? 'Atencao: ' : '';
  return `${prefix}${Math.abs(change)}% ${direction} do mes anterior`;
}

function comparisonText(current, previous, label) {
  if (previous <= 0 && current > 0) return `${label} sem base em ${previousMonth}`;
  const change = percentChange(current, previous);
  return `${change >= 0 ? '+' : ''}${change}% vs ${previousMonth}`;
}

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
      <div class="metric-label">${label}<span class="balance-eye">ver</span></div>
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
      <div class="panel-title sheet-title">
        <div>
          <span>${scopeLabel()}</span>
          <h2>${isIncome ? 'Nova receita' : 'Novo gasto'}</h2>
        </div>
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
  const assistant = assistantInsight();
  const assistantActionAttr = assistant.manageSection
    ? `data-manage-section="${assistant.manageSection}"`
    : `data-tab-jump="${assistant.target}"`;
  const categories = state.categories
    .map(
      (category) =>
        `<span class="chip"><span class="dot" style="background:${category.color}"></span>${escapeHtml(category.name)}</span>`,
    )
    .join('');
  const onboarding = onboardingCard();

  return `
    ${onboarding}
    ${dashboardInsights()}
    <article class="assistant-card ${assistant.tone}">
      <div class="assistant-icon">${icon('chat')}</div>
      <div>
        <span>EconoAssistente</span>
        <strong>${escapeHtml(assistant.title)}</strong>
        <p>${escapeHtml(assistant.copy)}</p>
        <button class="assistant-action" type="button" ${assistantActionAttr}>${escapeHtml(assistant.action)}</button>
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

function assistantInsight() {
  const totals = scopedTotals();
  const transactions = scopedTransactions();
  const expenses = totalsByCategory('EXPENSE').sort((a, b) => b.total - a.total);
  const topExpense = expenses[0];
  const topPercent = topExpense && totals.expense > 0 ? Math.round((topExpense.total / totals.expense) * 100) : 0;
  const budget = Number(state.budgets[state.scope] || 0);
  const budgetUsed = budget > 0 ? Math.round((totals.expense / budget) * 100) : 0;
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);

  if (!transactions.length) {
    return {
      action: 'Criar lancamento',
      copy: 'Comece registrando uma receita ou gasto. Depois eu consigo apontar categorias, limites e tendencias.',
      target: 'launch',
      title: 'Vamos criar sua primeira leitura',
      tone: 'neutral',
    };
  }

  if (totals.balance < 0) {
    return {
      action: 'Ver gastos',
      copy: `O resultado esta negativo em ${money.format(Math.abs(totals.balance))}. Comece revisando ${topExpense?.name || 'os maiores gastos'} antes de novos lancamentos.`,
      target: 'reports',
      title: 'Alerta de resultado negativo',
      tone: 'warning',
    };
  }

  if (budget > 0 && budgetUsed >= 90) {
    return {
      action: 'Ajustar limite',
      copy: `Voce ja usou ${budgetUsed}% do limite de ${scopeLabel().toLowerCase()}. Reduza gastos variaveis ou aumente o limite se ele estiver defasado.`,
      target: 'budget',
      title: 'Limite quase no teto',
      tone: 'warning',
    };
  }

  if (topExpense && topPercent >= 45) {
    return {
      action: 'Analisar categoria',
      copy: `${topExpense.name} concentra ${topPercent}% dos gastos. Se for recorrente, vale definir uma meta especifica para essa categoria.`,
      target: 'reports',
      title: 'Gasto concentrado detectado',
      tone: 'attention',
    };
  }

  if (!budget && totals.expense > 0) {
    return {
      action: 'Definir limite',
      copy: `Voce ja tem ${money.format(totals.expense)} em gastos no periodo. Criar um limite ajuda a acompanhar o ritmo antes do fim do mes.`,
      target: 'budget',
      title: 'Falta um teto de gastos',
      tone: 'neutral',
    };
  }

  if (state.scope === 'BUSINESS' && !state.channels.length) {
    return {
      action: 'Criar canal',
      copy: 'No modo negocio, canais de venda deixam claro de onde vem o faturamento e quais taxas pesam mais.',
      manageSection: 'channels',
      target: 'more',
      title: 'Separe seus canais de venda',
      tone: 'neutral',
    };
  }

  if (!scopedWallets.length && !scopedCards.length) {
    return {
      action: 'Gerenciar contas',
      copy: 'Cadastre banco, carteira ou cartao para entender onde o dinheiro entra, sai e fica parado.',
      manageSection: 'accounts',
      target: 'more',
      title: 'Organize os meios de pagamento',
      tone: 'neutral',
    };
  }

  if (topExpense) {
    return {
      action: 'Ver relatorios',
      copy: `${topExpense.name} e a maior categoria agora, mas seu resultado segue positivo em ${money.format(totals.balance)}.`,
      target: 'reports',
      title: 'Controle em bom ritmo',
      tone: 'positive',
    };
  }

  return {
    action: 'Ver fluxo',
    copy: `Saldo positivo de ${money.format(totals.balance)} neste periodo. Continue registrando para eu comparar melhor os proximos meses.`,
    target: 'transactions',
    title: 'Saldo positivo',
    tone: 'positive',
  };
}

function dashboardInsights() {
  const totals = scopedTotals();
  const expenses = totalsByCategory('EXPENSE').sort((a, b) => b.total - a.total);
  const topExpense = expenses[0];
  const budget = Number(state.budgets[state.scope] || 0);
  const budgetUsed = budget > 0 ? Math.min(100, Math.round((totals.expense / budget) * 100)) : 0;
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const walletBalance = scopedWallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  const insight =
    totals.expense > totals.income && totals.income > 0
      ? 'Gastos acima das receitas neste mes.'
      : topExpense
        ? `${topExpense.name} concentra seus maiores gastos.`
        : 'Registre lancamentos para gerar insights.';

  return `
    <article class="insight-card">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Resumo do mes</span>
          <h2>${scopeLabel()}</h2>
        </div>
        <button class="button secondary compact-action" type="button" data-tab-jump="reports">Relatorios</button>
      </div>
      <div class="insight-grid">
        <div class="insight-metric">
          <span>Resultado</span>
          <strong class="${totals.balance < 0 ? 'expense' : 'income'}">${money.format(totals.balance)}</strong>
        </div>
        <div class="insight-metric">
          <span>Contas</span>
          <strong>${money.format(walletBalance)}</strong>
        </div>
      </div>
      <div class="insight-progress">
        <div><span>Limite usado</span><strong>${budget ? `${budgetUsed}%` : 'Nao definido'}</strong></div>
        <div class="budget-progress"><span style="width:${budgetUsed}%"></span></div>
      </div>
      <div class="insight-note">
        <span class="row-icon neutral-bg">${topExpense ? topExpense.name.slice(0, 1).toUpperCase() : icon('target')}</span>
        <p>${escapeHtml(insight)}</p>
      </div>
    </article>
  `;
}

function onboardingCard() {
  const hasAccount = state.wallets.some((wallet) => !wallet.scope || wallet.scope === state.scope);
  const hasCategories = state.categories.some((category) => {
    const kind = state.categoryKinds[category.id];
    return state.scope === 'BUSINESS' ? kind === 'INCOME' || kind === 'EXPENSE' : kind !== 'INCOME' || kind === 'EXPENSE';
  });
  const hasTransaction = scopedTransactions().length > 0;
  if (state.onboardingDismissed || (hasAccount && hasCategories && hasTransaction)) return '';

  const steps = [
    {
      action: 'accounts',
      done: hasAccount,
      icon: icon('wallet'),
      title: 'Conta ou carteira',
      copy: 'Defina onde o dinheiro entra e sai.',
    },
    {
      action: 'seed-categories',
      done: hasCategories,
      icon: icon('tag'),
      title: 'Categorias iniciais',
      copy: 'Crie uma base para receitas e gastos.',
    },
    {
      action: 'transaction',
      done: hasTransaction,
      icon: icon('plus'),
      title: 'Primeiro lancamento',
      copy: 'Registre uma entrada ou despesa.',
    },
  ];

  return `
    <article class="onboarding-card">
      <div class="onboarding-head">
        <div>
          <span>Primeiros passos</span>
          <h2>Configure seu EconoApp</h2>
          <p>Complete o basico para acompanhar seu dinheiro com dados organizados.</p>
        </div>
        <button class="icon-button compact" type="button" data-onboarding-dismiss aria-label="Ocultar primeiros passos">x</button>
      </div>
      <div class="onboarding-steps">
        ${steps
          .map(
            (step) => `
              <button class="onboarding-step ${step.done ? 'done' : ''}" type="button" data-onboarding-action="${step.action}">
                <span class="step-icon">${step.done ? 'OK' : step.icon}</span>
                <span><strong>${step.title}</strong><small>${step.copy}</small></span>
                <span class="step-arrow">${step.done ? 'ok' : '>'}</span>
              </button>
            `,
          )
          .join('')}
      </div>
    </article>
  `;
}

function transactionsView() {
  return `
    <label class="search-field"><input type="search" placeholder="Buscar transacoes" value="${escapeHtml(state.transactionSearch)}" data-transaction-search /></label>
    <div class="filter-chips">
      ${transactionFilterButton('ALL', 'Todos')}
      ${transactionFilterButton('INCOME', 'Receitas')}
      ${transactionFilterButton('EXPENSE', 'Gastos')}
      ${transactionFilterButton('TRANSFER', 'Transferencias')}
    </div>
    <div class="period-switch">
      <button type="button">Abril</button>
      <button class="active" type="button">${currentMonth}</button>
      <button type="button">Junho</button>
    </div>
    <article class="card" data-transaction-list>
      ${transactionListHtml()}
    </article>
  `;
}

function transactionFilterButton(filter, label) {
  return `<button class="${state.transactionFilter === filter ? 'active' : ''}" type="button" data-transaction-filter="${filter}">${label}</button>`;
}

function filteredTransactions() {
  const query = state.transactionSearch.trim().toLowerCase();
  return scopedTransactions().filter((transaction) => {
    if (state.transactionFilter !== 'ALL' && transaction.type !== state.transactionFilter) return false;
    if (!query) return true;

    const category = state.categories.find((item) => item.id === transaction.categoryId);
    const payment = paymentMetaForTransaction(transaction);
    const haystack = [
      transaction.description,
      category?.name,
      transaction.source,
      payment?.label,
      transactionScope(transaction) === 'BUSINESS' ? 'negocio' : 'pessoal',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function transactionListHtml() {
  const rows = filteredTransactions().map(transactionRow).join('');
  return rows || emptyState('Nenhum lancamento encontrado', 'Ajuste a busca ou toque no + para adicionar um lancamento.', '+');
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
  const paymentLabel = isExpense ? 'Forma de pagamento' : 'Receber em';
  const quickAmounts = isExpense ? ['25,00', '50,00', '100,00'] : ['250,00', '1.000,00', '2.500,00'];
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
    <form class="form transaction-form" data-transaction-form data-context="${context}">
      <div class="entry-hero ${isExpense ? 'expense-mode' : 'income-mode'}">
        <div class="entry-mode-row">
          <span class="entry-mode-icon ${isExpense ? 'expense-bg' : 'income-bg'}">${isExpense ? icon('minus') : icon('plus')}</span>
          <span><strong>${isExpense ? 'Saida de dinheiro' : 'Entrada de dinheiro'}</strong><small>${scopeLabel()} - ${currentMonth}</small></span>
        </div>
        <div class="type-toggle" aria-label="Tipo do lancamento">
          <label class="${isExpense ? 'active' : ''}">
            <input type="radio" name="type" value="EXPENSE" data-transaction-type ${isExpense ? 'checked' : ''} />
            <span>Gasto</span>
          </label>
          <label class="${isExpense ? '' : 'active'}">
            <input type="radio" name="type" value="INCOME" data-transaction-type ${isExpense ? '' : 'checked'} />
            <span>Receita</span>
          </label>
        </div>
        <label class="amount-field">
          <span>Valor</span>
          <input class="amount-input" name="amount" inputmode="decimal" required placeholder="R$ 0,00" />
        </label>
        <div class="amount-presets" aria-label="Valores rapidos">
          ${quickAmounts.map((amount) => `<button type="button" data-amount-preset="${amount}">R$ ${amount}</button>`).join('')}
        </div>
      </div>
      <div class="form-section">
        <label class="field form-row">
          <span class="row-icon neutral-bg">${icon('chat')}</span>
          <span>Descricao</span>
          <input name="description" required placeholder="Ex: Mercado, venda Shopee, frete" />
        </label>
        <label class="field select-row form-row">
          <span class="row-icon neutral-bg">${icon('tag')}</span>
          <span>${categoryLabel}</span>
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
        <label class="field select-row form-row ${isExpense ? '' : 'hidden'}">
          <span class="row-icon neutral-bg">${icon('wallet')}</span>
          <span>${paymentLabel}</span>
          <select name="paymentMethod" ${isExpense ? 'required' : ''}>
            ${expensePaymentOptions || '<option value="">Cadastre uma carteira, banco ou cartao</option>'}
          </select>
        </label>
        <label class="field select-row form-row ${isExpense ? 'hidden' : ''}">
          <span class="row-icon neutral-bg">${icon('wallet')}</span>
          <span>${paymentLabel}</span>
          <select name="receiveAccount" ${isExpense ? '' : 'required'}>
            ${walletOptions || '<option value="">Cadastre um banco ou carteira</option>'}
          </select>
        </label>
        <label class="field select-row form-row ${state.scope === 'BUSINESS' ? '' : 'hidden'}">
          <span class="row-icon neutral-bg">${icon('shop')}</span>
          <span>Canal ou meio</span>
          <select name="channelId">
            <option value="">Sem canal</option>
            ${state.channels.map((channel) => `<option value="${channel.id}">${escapeHtml(channel.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="sheet-actions">
        <button class="button" type="submit">Salvar lancamento</button>
      </div>
    </form>
  `;
}

function manageView() {
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
        <div class="panel-title"><h2>Cartoes de credito</h2></div>
        <div class="credit-preview">
          <span>EconoApp</span>
          <strong>**** 1234</strong>
          <small>Credito</small>
        </div>
        <form class="form" data-card-form>
          <label class="field">Nome<input name="name" required placeholder="Ex: Nubank credito, Inter Black" /></label>
          <label class="field">Limite<input name="limit" inputmode="decimal" placeholder="0,00" /></label>
          <button class="button" type="submit">Criar cartao</button>
        </form>
        <div style="margin-top:14px">
          ${scopedCards.map((card) => `<div class="row"><div><div class="row-title">${escapeHtml(card.name)}</div><div class="row-meta">Cartao ${scopeLabel()} - limite ${money.format(Number(card.limit || 0))}</div></div></div>`).join('') || '<p class="empty">Cadastre cartoes para registrar gastos no credito.</p>'}
        </div>
      </article>
  `;

  const categoriesPanel = `
    <article class="card manage-panel">
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
          ${state.channels.map((channel) => `<div class="row"><div><div class="row-title">${escapeHtml(channel.name)}</div><div class="row-meta">Taxa ${Number(channel.feePercent).toFixed(2)}%</div></div></div>`).join('') || '<p class="empty">Cadastre canais para separar vendas do negocio.</p>'}
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

function reportsView() {
  const reportType = state.reportType || 'EXPENSE';
  const currentTransactions = scopedTransactionsForMonth(0);
  const previousTransactions = scopedTransactionsForMonth(-1);
  const currentTotals = totalsForTransactions(currentTransactions);
  const previousTotals = totalsForTransactions(previousTransactions);
  const incomeByCategory = totalsByCategoryForTransactions('INCOME', currentTransactions).sort((a, b) => b.total - a.total);
  const expenseByCategory = totalsByCategoryForTransactions('EXPENSE', currentTransactions).sort((a, b) => b.total - a.total);
  const categories = reportType === 'INCOME' ? incomeByCategory : expenseByCategory;
  const reportTotal = categories.reduce((sum, item) => sum + item.total, 0);
  const topCategory = categories[0];
  const topPercent = topCategory && reportTotal > 0 ? Math.round((topCategory.total / reportTotal) * 100) : 0;
  const reportLabel = reportType === 'INCOME' ? 'Receitas' : 'Gastos';
  const previousSelectedTotal = reportType === 'INCOME' ? previousTotals.income : previousTotals.expense;
  const reportInsight = topCategory
    ? `${topCategory.name} representa ${topPercent}% de ${reportLabel.toLowerCase()} no periodo.`
    : `Sem ${reportLabel.toLowerCase()} para analisar neste periodo.`;
  const balanceInsight =
    currentTotals.balance >= 0
      ? `Resultado positivo de ${money.format(currentTotals.balance)} em ${currentMonth}.`
      : `Resultado negativo de ${money.format(Math.abs(currentTotals.balance))}; vale revisar gastos recorrentes.`;
  const expenseInsight =
    previousTotals.expense <= 0 && currentTotals.expense > 0
      ? `Gastos registrados em ${currentMonth}, ainda sem base de comparacao com ${previousMonth}.`
      : currentTotals.expense > previousTotals.expense
        ? `Gastos subiram ${Math.abs(percentChange(currentTotals.expense, previousTotals.expense))}% contra ${previousMonth}.`
        : `Gastos ficaram ${Math.abs(percentChange(currentTotals.expense, previousTotals.expense))}% abaixo de ${previousMonth}.`;
  const incomeInsight =
    previousTotals.income <= 0 && currentTotals.income > 0
      ? `Receitas registradas em ${currentMonth}, ainda sem base de comparacao com ${previousMonth}.`
      : currentTotals.income >= previousTotals.income
        ? `Receitas evoluiram ${Math.abs(percentChange(currentTotals.income, previousTotals.income))}% no comparativo mensal.`
        : `Receitas cairam ${Math.abs(percentChange(currentTotals.income, previousTotals.income))}% no comparativo mensal.`;
  return `
    <div class="report-tabs">
      ${reportTab('EXPENSE', 'Gastos')}
      ${reportTab('INCOME', 'Receitas')}
    </div>
    <div class="period-switch">
      <button type="button">${previousMonth}</button>
      <button class="active" type="button">${currentMonth}</button>
      <button type="button">${nextMonth}</button>
    </div>
    <article class="report-summary">
      <div class="report-summary-item">
        <span>Receitas</span>
        <strong class="income">${money.format(currentTotals.income)}</strong>
        <small>${changeText(currentTotals.income, previousTotals.income)}</small>
      </div>
      <div class="report-summary-item">
        <span>Gastos</span>
        <strong class="expense">${money.format(currentTotals.expense)}</strong>
        <small>${changeText(currentTotals.expense, previousTotals.expense, 'expense')}</small>
      </div>
    </article>
    <article class="report-comparison">
      <div>
        <span class="eyebrow">Comparativo mensal</span>
        <h2>${reportLabel} em ${currentMonth}</h2>
        <p>${comparisonText(reportTotal, previousSelectedTotal, reportLabel)}</p>
      </div>
      <div class="comparison-bars" aria-hidden="true">
        <span style="height:${comparisonBarHeight(previousSelectedTotal, reportTotal)}%"></span>
        <span class="active" style="height:${comparisonBarHeight(reportTotal, previousSelectedTotal)}%"></span>
      </div>
    </article>
    <article class="report-insight">
      <span class="row-icon neutral-bg">${topCategory ? topCategory.name.slice(0, 1).toUpperCase() : icon('reports')}</span>
      <div>
        <strong>Insight do periodo</strong>
        <p>${escapeHtml(reportInsight)}</p>
      </div>
    </article>
    <article class="card report-advice">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Leitura rapida</span>
          <h2>O que observar</h2>
          <p class="report-advice-summary">${escapeHtml(balanceInsight)}</p>
        </div>
      </div>
      <div class="advice-list">
        <div><span class="row-icon income-bg">${icon('reports')}</span><p>${escapeHtml(incomeInsight)}</p></div>
        <div><span class="row-icon expense-bg">${icon('target')}</span><p>${escapeHtml(expenseInsight)}</p></div>
      </div>
    </article>
    <div class="split">
      <article class="card report-panel">
        <div class="panel-title">
          <div>
            <span class="eyebrow">${reportLabel}</span>
            <h2>Por categoria</h2>
          </div>
          <strong>${money.format(reportTotal)}</strong>
        </div>
        <div class="donut-wrap">
          <div class="donut-chart" style="${donutStyle(categories, reportTotal)}"></div>
          <div class="donut-center"><span>Total</span><strong>${money.format(reportTotal)}</strong></div>
        </div>
        ${
          topCategory
            ? `<div class="report-highlight">
                <span class="row-icon" style="background:${topCategory.color}">${topCategory.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <span>Maior categoria</span>
                  <strong>${escapeHtml(topCategory.name)}</strong>
                  <small>${topPercent}% do total selecionado</small>
                </div>
              </div>`
            : ''
        }
        ${categoryRows(categories, reportTotal) || '<p class="empty">Nao ha dados disponiveis no periodo.</p>'}
      </article>
    </div>
  `;
}

function reportTab(type, label) {
  return `<button class="${state.reportType === type ? 'active' : ''}" type="button" data-report-type="${type}">${label}</button>`;
}

function comparisonBarHeight(value, otherValue) {
  const max = Math.max(Number(value || 0), Number(otherValue || 0), 1);
  return Math.max(18, Math.round((Number(value || 0) / max) * 100));
}

function donutStyle(items, total) {
  if (!items.length || total <= 0) return 'background: conic-gradient(#e5ebe7 0% 100%);';
  let cursor = 0;
  const stops = items.map((item, index) => {
    const start = cursor;
    const end = index === items.length - 1 ? 100 : cursor + (Number(item.total || 0) / total) * 100;
    cursor = end;
    return `${item.color || colors[index % colors.length]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `background: conic-gradient(${stops.join(', ')});`;
}

function budgetView() {
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
          <button class="menu-item" type="button" data-manage-section="accounts"><span class="tab-icon">${icon('wallet')}</span><span>Contas e cartoes</span><span>></span></button>
          <button class="menu-item" type="button" data-manage-section="categories"><span class="tab-icon">${icon('tag')}</span><span>Categorias e canais</span><span>></span></button>
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

function categoryRows(items, total = 0) {
  return items
    .map((category) => {
      const percent = total > 0 ? Math.round((Number(category.total || 0) / total) * 100) : 0;
      return `
        <div class="row category-row">
          <div class="category-row-main">
            <span class="row-icon" style="background:${category.color}">${category.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <div class="row-title">${escapeHtml(category.name)}</div>
              <div class="category-share"><span style="width:${percent}%"></span></div>
            </div>
          </div>
          <div class="category-row-value">
            <strong>${money.format(category.total)}</strong>
            <small>${percent}%</small>
          </div>
        </div>
      `;
    })
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
