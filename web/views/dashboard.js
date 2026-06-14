import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTotals, scopedTransactions, scopeLabel, totalsByCategory } from '../finance.js';
import { currentMonth, emptyState, icon, transactionRow } from './shared.js';

export function dashboardView() {
  const rows = scopedTransactions().slice(0, 4).map(transactionRow).join('');
  const assistant = assistantInsight();
  const assistantActionAttr = assistant.manageSection
    ? `data-manage-section="${assistant.manageSection}"`
    : `data-tab-jump="${assistant.target}"`;
  const onboarding = onboardingCard();

  return `
    ${onboarding}
    <article class="assistant-card dashboard-assistant ${assistant.tone}">
      <div class="assistant-icon">${icon('chat')}</div>
      <div class="assistant-copy">
        <span>EconoAssistente</span>
        <strong>${escapeHtml(assistant.title)}</strong>
        <p>${escapeHtml(assistant.copy)}</p>
      </div>
      <button class="assistant-action" type="button" ${assistantActionAttr}>${escapeHtml(assistant.action)}</button>
    </article>
    <article class="card dashboard-recent">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Movimentações</span>
          <h2>Últimos lançamentos</h2>
        </div>
        <button class="button secondary compact-action" type="button" data-tab-jump="transactions">Ver fluxo</button>
      </div>
      ${rows || emptyState('Nenhum lançamento no período', 'Toque no + para adicionar uma receita ou gasto.', '+')}
    </article>
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
  const completedSteps = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);

  return `
    <article class="onboarding-card onboarding-compact">
      <div class="onboarding-head">
        <div>
          <span>Primeiros passos · ${completedSteps} de ${steps.length}</span>
          <h2>${escapeHtml(nextStep.title)}</h2>
          <p>${escapeHtml(nextStep.copy)}</p>
        </div>
        <button class="icon-button compact" type="button" data-onboarding-dismiss aria-label="Ocultar primeiros passos">x</button>
      </div>
      <button class="button onboarding-next" type="button" data-onboarding-action="${nextStep.action}">
        ${nextStep.icon}
        Continuar configuração
      </button>
    </article>
  `;
}
