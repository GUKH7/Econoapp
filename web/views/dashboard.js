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

  return `
    ${state.scope === 'BUSINESS' ? businessSummaryCard() : ''}
    <article class="assistant-card dashboard-assistant ${assistant.tone}">
      <div class="assistant-icon">${icon('chat')}</div>
      <div class="assistant-copy">
        <span>Din</span>
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
