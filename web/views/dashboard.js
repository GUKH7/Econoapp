import { colors, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTotals, scopedTransactions, scopeLabel, totalsByCategory } from '../finance.js';
import { currentMonth, emptyState, icon, transactionRow } from './shared.js';

export function dashboardView() {
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
        ${rows || emptyState('Nenhum lançamento no período', 'Toque no + para adicionar uma receita ou gasto.', '+')}
      </article>
      <article class="card">
        <div class="panel-title"><h2>Categorias</h2><button class="button secondary" type="button" data-tab-jump="more">Editar</button></div>
        <div class="chip-list">${categories || '<p class="empty">Crie categorias para organizar os lançamentos.</p>'}</div>
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
  const budgetSpent = Number(state.budgetSummary?.totalSpent ?? totals.expense);
  const budgetUsed = budget > 0 ? Math.round((budgetSpent / budget) * 100) : 0;
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);

  if (!transactions.length) {
    return {
      action: 'Criar lançamento',
      copy: 'Comece registrando uma receita ou gasto. Depois eu consigo apontar categorias, limites e tendências.',
      target: 'launch',
      title: 'Vamos criar sua primeira leitura',
      tone: 'neutral',
    };
  }

  if (totals.balance < 0) {
    return {
      action: 'Ver gastos',
      copy: `O resultado está negativo em ${money.format(Math.abs(totals.balance))}. Comece revisando ${topExpense?.name || 'os maiores gastos'} antes de novos lançamentos.`,
      target: 'reports',
      title: 'Alerta de resultado negativo',
      tone: 'warning',
    };
  }

  if (budget > 0 && budgetUsed >= 90) {
    return {
      action: 'Ajustar limite',
      copy: `Você já usou ${budgetUsed}% do limite de ${scopeLabel().toLowerCase()}. Reduza gastos variáveis ou aumente o limite se ele estiver defasado.`,
      target: 'budget',
      title: 'Limite quase no teto',
      tone: 'warning',
    };
  }

  if (topExpense && topPercent >= 45) {
    return {
      action: 'Analisar categoria',
      copy: `${topExpense.name} concentra ${topPercent}% dos gastos. Se for recorrente, vale definir uma meta específica para essa categoria.`,
      target: 'reports',
      title: 'Gasto concentrado detectado',
      tone: 'attention',
    };
  }

  if (!budget && totals.expense > 0) {
    return {
      action: 'Definir limite',
      copy: `Você já tem ${money.format(totals.expense)} em gastos no período. Criar um limite ajuda a acompanhar o ritmo antes do fim do mês.`,
      target: 'budget',
      title: 'Falta um teto de gastos',
      tone: 'neutral',
    };
  }

  if (state.scope === 'BUSINESS' && !state.channels.length) {
    return {
      action: 'Criar canal',
      copy: 'No modo negócio, canais de venda deixam claro de onde vem o faturamento e quais taxas pesam mais.',
      manageSection: 'channels',
      target: 'more',
      title: 'Separe seus canais de venda',
      tone: 'neutral',
    };
  }

  if (!scopedWallets.length && !scopedCards.length) {
    return {
      action: 'Gerenciar contas',
      copy: 'Cadastre banco, carteira ou cartão para entender onde o dinheiro entra, sai e fica parado.',
      manageSection: 'accounts',
      target: 'more',
      title: 'Organize os meios de pagamento',
      tone: 'neutral',
    };
  }

  if (topExpense) {
    return {
      action: 'Ver relatórios',
      copy: `${topExpense.name} e a maior categoria agora, mas seu resultado segue positivo em ${money.format(totals.balance)}.`,
      target: 'reports',
      title: 'Controle em bom ritmo',
      tone: 'positive',
    };
  }

  return {
    action: 'Ver fluxo',
    copy: `Saldo positivo de ${money.format(totals.balance)} neste período. Continue registrando para eu comparar melhor os próximos meses.`,
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
  const budgetSpent = Number(state.budgetSummary?.totalSpent ?? totals.expense);
  const budgetUsed = budget > 0 ? Math.min(100, Math.round((budgetSpent / budget) * 100)) : 0;
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const walletBalance = scopedWallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  const insight =
    totals.expense > totals.income && totals.income > 0
      ? 'Gastos acima das receitas neste mês.'
      : topExpense
        ? `${topExpense.name} concentra seus maiores gastos.`
        : 'Registre lançamentos para gerar insights.';

  return `
    <article class="insight-card">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Resumo do mês</span>
          <h2>${scopeLabel()}</h2>
        </div>
        <button class="button secondary compact-action" type="button" data-tab-jump="reports">Relatórios</button>
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
        <div><span>Limite usado</span><strong>${budget ? `${budgetUsed}%` : 'Não definido'}</strong></div>
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
      title: 'Primeiro lançamento',
      copy: 'Registre uma entrada ou despesa.',
    },
  ];

  return `
    <article class="onboarding-card">
      <div class="onboarding-head">
        <div>
          <span>Primeiros passos</span>
          <h2>Configure seu EconoApp</h2>
          <p>Complete o básico para acompanhar seu dinheiro com dados organizados.</p>
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
