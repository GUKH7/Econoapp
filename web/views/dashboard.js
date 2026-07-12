import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTotals, scopedTransactions, scopeLabel, totalsByCategory } from '../finance.js';
import {
  currentMonth,
  emptyState,
  icon,
  monthKey,
  previousMonth,
  scopedTransactionsForMonth,
  totalsByCategoryForTransactions,
  totalsForTransactions,
  transactionRow,
  transactionValue,
} from './shared.js';

export function dashboardView() {
  const rows = scopedTransactions().slice(0, 3).map(transactionRow).join('');

  return `
    ${onboardingGuideHtml()}
    ${state.scope === 'BUSINESS' ? businessSummaryCard() : ''}
    ${dashboardInsightsHtml()}
    <article class="card dashboard-recent">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Movimentações</span>
          <h2>Últimos lançamentos</h2>
        </div>
        <button class="button secondary compact-action" type="button" data-tab-jump="transactions">Ver fluxo</button>
      </div>
      ${
        rows ||
        emptyState(
          'Comece seu histórico financeiro',
          'Adicione uma receita ou gasto para o Din montar seu resumo do mês.',
          icon('plus'),
          { label: 'Adicionar lançamento', attrs: 'data-assistant-action="expense"' },
        )
      }
    </article>
  `;
}

function onboardingGuideHtml() {
  if (state.onboardingDismissed) return '';

  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const hasCategories = state.categories.length > 0;
  const hasAccount = scopedWallets.length > 0;
  const hasTransactions = scopedTransactions().length > 0;
  const isComplete = state.onboardingProfileDone && hasCategories && hasAccount;

  if (isComplete && hasTransactions) return '';

  const steps = [
    { label: 'Perfil', done: state.onboardingProfileDone },
    { label: 'Categorias', done: hasCategories },
    { label: 'Conta', done: hasAccount },
    { label: 'Lancamento', done: hasTransactions },
  ];
  const nextStep = steps.find((step) => !step.done)?.label || 'Lancamento';
  const progress = Math.round((steps.filter((step) => step.done).length / steps.length) * 100);

  return `
    <article class="onboarding-card guided-onboarding">
      <div class="onboarding-head">
        <div>
          <span>Primeiro acesso</span>
          <h2>${onboardingTitle(nextStep)}</h2>
          <p>${onboardingCopy(nextStep)}</p>
        </div>
        <button class="icon-button" type="button" data-onboarding-dismiss aria-label="Fechar">x</button>
      </div>
      <div class="onboarding-progress" aria-label="Progresso do onboarding">
        <span style="width:${progress}%"></span>
      </div>
      <div class="onboarding-steps">
        ${steps
          .map(
            (step) => `
              <span class="${step.done ? 'done' : step.label === nextStep ? 'active' : ''}">
                ${step.done ? '✓' : ''}${escapeHtml(step.label)}
              </span>
            `,
          )
          .join('')}
      </div>
      ${onboardingStepBody(nextStep)}
    </article>
  `;
}

function onboardingTitle(step) {
  const titles = {
    Perfil: 'Escolha como quer organizar o Din',
    Categorias: 'Crie categorias iniciais em um toque',
    Conta: 'Cadastre onde seu dinheiro fica',
    Lancamento: 'Registre o primeiro movimento',
  };
  return titles[step] || titles.Lancamento;
}

function onboardingCopy(step) {
  const copies = {
    Perfil: 'Comece separando vida pessoal e negocio. Voce pode alternar quando quiser.',
    Categorias: 'Alimentacao, moradia, transporte, saude, lazer, salario e vendas ja deixam tudo mais automatico.',
    Conta: 'Uma conta bancaria ou carteira permite acompanhar saldo real e fluxo por origem.',
    Lancamento: 'Com uma receita ou gasto registrado, o Din ja consegue montar um resumo melhor.',
  };
  return copies[step] || copies.Lancamento;
}

function onboardingStepBody(step) {
  if (step === 'Perfil') {
    return `
      <div class="onboarding-actions two">
        <button class="button secondary" type="button" data-onboarding-action="profile-personal">Pessoal</button>
        <button class="button" type="button" data-onboarding-action="profile-business">Pessoal + negocio</button>
      </div>
    `;
  }

  if (step === 'Categorias') {
    return `
      <div class="onboarding-actions">
        <button class="button" type="button" data-onboarding-action="seed-categories">Criar categorias padrao</button>
      </div>
    `;
  }

  if (step === 'Conta') {
    return `
      <form class="onboarding-account-form" data-onboarding-account-form>
        <input name="name" placeholder="Ex: Nubank, Inter, Carteira" required />
        <select name="type" aria-label="Tipo de conta">
          <option value="BANK">Conta bancaria</option>
          <option value="WALLET">Carteira/dinheiro</option>
        </select>
        <input name="balance" inputmode="decimal" placeholder="Saldo inicial" />
        <button class="button" type="submit">Salvar conta</button>
      </form>
    `;
  }

  return `
    <div class="onboarding-actions two">
      <button class="button secondary" type="button" data-onboarding-action="transaction-income">Nova receita</button>
      <button class="button" type="button" data-onboarding-action="transaction">Novo gasto</button>
    </div>
  `;
}

function dashboardInsightsHtml() {
  const currentTransactions = scopedTransactionsForMonth(0);
  const currentTotals = totalsForTransactions(currentTransactions);
  const topExpense = currentTransactions
    .filter((transaction) => transaction.type === 'EXPENSE')
    .sort((a, b) => transactionValue(b) - transactionValue(a))[0];
  const projected = projectedMonthBalance(currentTotals);
  const budgetAlert = budgetAlertInfo(currentTotals.expense);

  return `
    <section class="dashboard-insights">
      <div class="dashboard-kpi-grid">
        ${dashboardKpiCard('Maior gasto', topExpense ? topExpense.description : 'Sem gastos', topExpense ? money.format(transactionValue(topExpense)) : money.format(0), topExpense ? 'expense' : 'neutral')}
        ${dashboardKpiCard('Saldo previsto', projected.label, money.format(projected.balance), projected.balance >= 0 ? 'income' : 'expense')}
        ${dashboardKpiCard('Orcamento', budgetAlert.title, budgetAlert.value, budgetAlert.tone)}
      </div>
      ${budgetAlert.copy ? `<article class="dashboard-alert ${budgetAlert.tone}"><span>${icon('target')}</span><p>${escapeHtml(budgetAlert.copy)}</p></article>` : ''}
    </section>
  `;
}

function dashboardKpiCard(label, title, value, tone = 'neutral') {
  return `
    <article class="dashboard-kpi ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(title)}</small>
    </article>
  `;
}

function dashboardCategoryRows(categories, total) {
  return categories
    .slice(0, 4)
    .map((category) => {
      const percent = total > 0 ? Math.round((Number(category.total || 0) / total) * 100) : 0;
      return `
        <div class="dashboard-category-row">
          <span class="row-icon" style="background:${escapeHtml(category.color || '#22C55E')}">${escapeHtml(category.name.slice(0, 1).toUpperCase())}</span>
          <div>
            <strong>${escapeHtml(category.name)}</strong>
            <div class="category-share"><span style="width:${percent}%"></span></div>
          </div>
          <small>${money.format(category.total)} - ${percent}%</small>
        </div>
      `;
    })
    .join('');
}

function monthlyEvolutionHtml() {
  const months = [-3, -2, -1, 0].map((offset) => {
    const date = new Date();
    date.setMonth(date.getMonth() + offset, 1);
    const label = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '');
    const totals = totalsForTransactions(scopedTransactionsForMonth(offset));
    return { label, totals };
  });
  const max = Math.max(...months.map((item) => item.totals.income + item.totals.expense), 1);
  return `
    <div class="monthly-evolution">
      ${months
        .map(
          (item) => `
            <div class="month-bar">
              <div>
                <span class="income" style="height:${barHeight(item.totals.income, max)}%"></span>
                <span class="expense" style="height:${barHeight(item.totals.expense, max)}%"></span>
              </div>
              <strong>${escapeHtml(item.label)}</strong>
            </div>
          `,
        )
        .join('')}
    </div>
    <div class="evolution-legend">
      <span><b class="income-dot"></b>Receitas</span>
      <span><b class="expense-dot"></b>Gastos</span>
    </div>
  `;
}

function barHeight(value, max) {
  if (value <= 0) return 4;
  return Math.max(12, Math.round((value / max) * 100));
}

function monthlyEvolutionTitle(currentTotals, previousTotals) {
  if (previousTotals.expense <= 0 && currentTotals.expense > 0) return `Primeiro comparativo de ${currentMonth}`;
  if (currentTotals.expense > previousTotals.expense) return `Gastos acima de ${previousMonth}`;
  if (currentTotals.expense < previousTotals.expense) return `Gastos abaixo de ${previousMonth}`;
  return 'Mes estavel';
}

function projectedMonthBalance(currentTotals) {
  const now = new Date();
  const currentKey = monthKey(0);
  const pending = state.recurringTransactions
    .filter((rule) => rule.isActive !== false && (!rule.scope || rule.scope === state.scope))
    .filter((rule) => {
      const date = new Date(rule.nextRunAt);
      if (Number.isNaN(date.getTime())) return false;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return key === currentKey && date >= startOfToday(now);
    })
    .reduce(
      (acc, rule) => {
        const amount = Number(rule.amount || 0);
        if (rule.type === 'INCOME') acc.income += amount;
        if (rule.type === 'EXPENSE') acc.expense += amount;
        return acc;
      },
      { income: 0, expense: 0 },
    );
  const balance = currentTotals.balance + pending.income - pending.expense;
  const label = pending.income || pending.expense ? 'Com recorrencias do mes' : 'Sem recorrencias pendentes';
  return { balance, label };
}

function budgetAlertInfo(currentExpense) {
  const categoryAlerts = (state.categoryBudgets || [])
    .filter((budget) => !budget.scope || budget.scope === state.scope)
    .map((budget) => ({
      name: budget.categoryName || 'Categoria',
      percentage: Number(budget.percentage || 0),
      amount: Number(budget.amount || 0),
      spent: Number(budget.spent || 0),
    }))
    .sort((a, b) => b.percentage - a.percentage);
  const top = categoryAlerts[0];
  const totalLimit = Number(state.budgetSummary?.totalLimit || state.budgets[state.scope] || 0);
  const totalSpent = Number(state.budgetSummary?.totalSpent ?? currentExpense);
  const totalPercent = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;

  if (top && top.percentage >= 100) {
    return {
      title: `${top.name} estourou`,
      value: `${Math.round(top.percentage)}%`,
      tone: 'expense',
      copy: `${top.name} ja passou do limite. Vale revisar lancamentos recentes ou ajustar o teto.`,
    };
  }
  if (top && top.percentage >= 85) {
    return {
      title: `${top.name} no limite`,
      value: `${Math.round(top.percentage)}%`,
      tone: 'warning',
      copy: `${top.name} esta perto do limite definido. Um alerta agora evita surpresa no fim do mes.`,
    };
  }
  if (totalLimit > 0) {
    return {
      title: `${totalPercent}% usado`,
      value: money.format(Math.max(0, totalLimit - totalSpent)),
      tone: totalPercent >= 85 ? 'warning' : 'income',
      copy: totalPercent >= 85 ? 'O limite geral esta quase no teto para este escopo.' : '',
    };
  }
  return {
    title: 'Sem limite',
    value: 'Definir',
    tone: 'neutral',
    copy: currentExpense > 0 ? 'Defina um orcamento para receber alertas antes de passar do ponto.' : '',
  };
}

function startOfToday(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

function businessSummaryCard() {
  const transactions = scopedTransactions();
  const totals = scopedTotals();
  const margin = totals.income > 0 ? Math.round((totals.balance / totals.income) * 100) : 0;
  const channelRows = channelSummary(transactions);
  const bestChannel = channelRows[0];
  const channelTotal = channelRows.reduce((sum, item) => sum + item.total, 0);

  return `
    <article class="business-summary-card">
      <div class="business-summary-head">
        <div>
          <span class="eyebrow">Resumo do negócio</span>
          <h2>${money.format(totals.income)}</h2>
          <p>Faturamento de ${currentMonth}</p>
        </div>
        <span class="business-badge ${totals.balance >= 0 ? 'positive' : 'negative'}">
          ${totals.balance >= 0 ? '+' : '-'}${Math.abs(margin)}%
        </span>
      </div>
      <div class="business-kpis">
        <div><span>Entradas</span><strong class="income">${money.format(totals.income)}</strong></div>
        <div><span>Saídas</span><strong class="expense">${money.format(totals.expense)}</strong></div>
        <div><span>Lucro</span><strong>${money.format(totals.balance)}</strong></div>
      </div>
      <div class="business-channel-block">
        <div class="panel-title compact">
          <div>
            <span class="eyebrow">Canais de venda</span>
            <h3>${bestChannel ? `Destaque: ${escapeHtml(bestChannel.name)}` : 'Sem canais registrados'}</h3>
          </div>
          <button class="button secondary compact-action" type="button" data-manage-section="channels">Gerenciar</button>
        </div>
        <div class="business-channel-list">
          ${
            channelRows.length
              ? channelRows.slice(0, 3).map((channel) => channelRow(channel, channelTotal)).join('')
              : '<p class="empty">Cadastre canais para enxergar de onde vem o faturamento.</p>'
          }
        </div>
      </div>
    </article>
  `;
}

function channelSummary(transactions) {
  const byChannel = new Map(
    state.channels.map((channel) => [
      channel.id,
      {
        color: channel.color || '#22C55E',
        id: channel.id,
        name: channel.name,
        total: 0,
      },
    ]),
  );

  transactions
    .filter((transaction) => transaction.type === 'INCOME' && transaction.channelId)
    .forEach((transaction) => {
      const channel = byChannel.get(transaction.channelId);
      if (channel) channel.total += Number(transaction.netAmount || transaction.amount || 0);
    });

  return [...byChannel.values()].filter((channel) => channel.total > 0).sort((a, b) => b.total - a.total);
}

function channelRow(channel, total) {
  const percent = total > 0 ? Math.round((channel.total / total) * 100) : 0;
  return `
    <div class="business-channel-row">
      <span class="row-icon" style="background:${escapeHtml(channel.color)}">${escapeHtml(channel.name.slice(0, 1).toUpperCase())}</span>
      <div>
        <strong>${escapeHtml(channel.name)}</strong>
        <div class="category-share"><span style="width:${percent}%"></span></div>
      </div>
      <small>${money.format(channel.total)} · ${percent}%</small>
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
      action: 'Conversar com o Din',
      copy: 'Me conte uma receita ou gasto pelo assistente e eu te ajudo a organizar o lançamento.',
      target: 'assistant',
      title: 'Pronto para começar',
      tone: 'neutral',
    };
  }

  if (totals.balance < 0) {
    return {
      action: 'Abrir Din',
      copy: `O resultado está negativo em ${money.format(Math.abs(totals.balance))}. Comece revisando ${topExpense?.name || 'os maiores gastos'} antes de novos lançamentos.`,
      target: 'assistant',
      title: 'Alerta de resultado negativo',
      tone: 'warning',
    };
  }

  if (budget > 0 && budgetUsed >= 90) {
    return {
      action: 'Abrir Din',
      copy: `Você já usou ${budgetUsed}% do limite de ${scopeLabel().toLowerCase()}. Reduza gastos variáveis ou aumente o limite se ele estiver defasado.`,
      target: 'assistant',
      title: 'Limite quase no teto',
      tone: 'warning',
    };
  }

  if (topExpense && topPercent >= 45) {
    return {
      action: 'Abrir Din',
      copy: `${topExpense.name} concentra ${topPercent}% dos gastos. Se for recorrente, vale definir uma meta específica para essa categoria.`,
      target: 'assistant',
      title: 'Gasto concentrado detectado',
      tone: 'attention',
    };
  }

  if (!budget && totals.expense > 0) {
    return {
      action: 'Abrir Din',
      copy: `Você já tem ${money.format(totals.expense)} em gastos no período. Criar um limite ajuda a acompanhar o ritmo antes do fim do mês.`,
      target: 'assistant',
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
      action: 'Abrir Din',
      copy: `${topExpense.name} é a maior categoria agora, mas seu resultado segue positivo em ${money.format(totals.balance)}.`,
      target: 'assistant',
      title: 'Controle em bom ritmo',
      tone: 'positive',
    };
  }

  return {
    action: 'Abrir Din',
    copy: `Saldo positivo de ${money.format(totals.balance)} neste período. Continue registrando para eu comparar melhor os próximos meses.`,
    target: 'assistant',
    title: 'Saldo positivo',
    tone: 'positive',
  };
}
