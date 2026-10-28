import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTotals, scopedTransactions } from '../finance.js';
import { icon, scopedTransactionsForMonth, totalsForTransactions, transactionRow } from './shared.js';

function valueOf(number) {
  return Number.isFinite(Number(number)) ? Number(number) : 0;
}

function monthResults() {
  return Array.from({ length: 6 }, (_, index) => {
    const offset = index - 5;
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + offset);
    const totals = totalsForTransactions(scopedTransactionsForMonth(offset));
    return {
      label: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', ''),
      balance: totals.balance,
      hasData: scopedTransactionsForMonth(offset).length > 0,
    };
  });
}

function resultsChart() {
  const items = monthResults();
  if (!items.some((item) => item.hasData)) {
    return '<div class="din-chart-empty">Registre lançamentos para acompanhar seus resultados mensais.</div>';
  }
  const values = items.map((item) => item.balance);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const points = values.map((value, index) => ({
    x: 12 + index * 59,
    y: 90 - ((value - minimum) / range) * 70,
  }));
  const line = points.map((point, index) => (index ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  const fill = line + ' L 307 100 L 12 100 Z';
  const dots = points.map((point, index) => {
    if (index !== points.length - 1) return '';
    return '<circle cx="' + point.x + '" cy="' + point.y + '" r="5" fill="#fff" stroke="#059B57" stroke-width="3"></circle>';
  }).join('');
  return [
    '<svg class="din-chart-svg" viewBox="0 0 320 108" preserveAspectRatio="none" role="img" aria-label="Resultado líquido de cada um dos últimos seis meses, calculado a partir dos lançamentos disponíveis">',
    '<defs><linearGradient id="dinChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#17C97B" stop-opacity=".24"/><stop offset="100%" stop-color="#17C97B" stop-opacity="0"/></linearGradient></defs>',
    '<path d="' + fill + '" fill="url(#dinChartFill)"></path>',
    '<path d="' + line + '" fill="none" stroke="#059B57" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>',
    dots, '</svg>',
    '<div class="din-chart-labels">' + items.map((item) => '<span>' + escapeHtml(item.label) + '</span>').join('') + '</div>',
  ].join('');
}

function progressPanel() {
  if (state.scope === 'BUSINESS') {
    const config = state.businessSummary?.configuration;
    const goal = valueOf(config?.revenueGoal);
    const achieved = valueOf(state.businessSummary?.statement?.grossRevenue);
    if (goal > 0) return progressMarkup('Meta de faturamento', achieved, goal, 'business');
  } else {
    const budget = (state.categoryBudgets || []).find((item) => valueOf(item.amount) > 0);
    if (budget) return progressMarkup('Orçamento: ' + (budget.categoryName || 'Categoria'), valueOf(budget.spent), valueOf(budget.amount), 'budget');
  }
  return '<p class="din-placeholder">Configure uma meta ou orçamento para acompanhar o progresso aqui.</p>';
}

function progressMarkup(label, amount, target, kind) {
  const percentage = Math.min(100, Math.max(0, Math.round((amount / target) * 100)));
  return [
    '<div class="din-progress-info"><span>' + escapeHtml(label) + '</span><strong>' + percentage + '%</strong></div>',
    '<div class="din-progress-track" role="progressbar" aria-label="' + escapeHtml(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percentage + '"><span style="width:' + percentage + '%"></span></div>',
    '<small>' + money.format(amount) + ' de ' + money.format(target) + (kind === 'budget' ? ' utilizados' : ' alcançados') + '</small>',
  ].join('');
}

export function dinHomeHtml() {
  const allTotals = scopedTotals();
  const current = totalsForTransactions(scopedTransactionsForMonth(0));
  const previous = totalsForTransactions(scopedTransactionsForMonth(-1));
  const businessBalance = state.businessSummary?.availableBalance;
  const balance = state.scope === 'BUSINESS' && businessBalance != null
    ? valueOf(businessBalance) : allTotals.balance;
  const comparison = previous.balance === 0
    ? 'Sem base de comparação no mês anterior'
    : (current.balance - previous.balance >= 0 ? '▲ ' : '▼ ') +
      Math.abs(Math.round(((current.balance - previous.balance) / Math.abs(previous.balance)) * 100)) +
      '% no resultado mensal vs mês anterior';
  const rows = [...scopedTransactions()]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4).map(transactionRow).join('');
  const totalMovement = current.income + current.expense;
  const incomeShare = totalMovement > 0 ? current.income / totalMovement * 100 : 50;
  const scopeText = state.scope === 'BUSINESS' ? 'Saldo disponível do negócio' : 'Saldo dos lançamentos';
  return [
    '<div class="din-home">',
      '<section class="din-hero" aria-label="Seu saldo">',
        '<div class="din-hero-copy"><span class="din-eyebrow">' + scopeText + '</span>',
          '<strong class="din-balance ' + (balance < 0 ? 'negative' : '') + '">' + money.format(balance) + '</strong>',
          '<span class="din-comparison">' + escapeHtml(comparison) + '</span>',
        '</div>',
        '<img class="din-mascot" src="./assets/din-mascote-oficial.webp" width="180" height="310" alt="Din, cachorro amarelo de óculos escuros e coleira verde" />',
      '</section>',
      '<section class="din-chart-section" aria-label="Evolução dos resultados">',
        '<div class="din-section-heading"><h2>Resultado dos últimos 6 meses</h2><span>Receitas − despesas</span></div>',
        resultsChart(),
      '</section>',
      '<section class="din-month" aria-label="Movimentações do mês">',
        '<div class="din-month-metrics">',
          '<div><span class="din-metric-icon income">' + icon('plus') + '</span><span>Entradas</span><strong>' + money.format(current.income) + '</strong></div>',
          '<div><span class="din-metric-icon expense">' + icon('minus') + '</span><span>Saídas</span><strong>' + money.format(current.expense) + '</strong></div>',
        '</div>',
        '<div class="din-movement-bar" role="img" aria-label="Proporção de entradas e saídas do mês"><span style="width:' + incomeShare.toFixed(1) + '%"></span></div>',
      '</section>',
      '<section class="din-actions" aria-label="Ações rápidas">',
        '<button type="button" class="din-quick primary" data-action-type="EXPENSE"><span>' + icon('plus') + '</span>Nova transação</button>',
        '<button type="button" class="din-quick" data-action-type="TRANSFER"><span>' + icon('flow') + '</span>Transferir</button>',
        '<button type="button" class="din-quick" data-manage-section="cards"><span>' + icon('card') + '</span>Cartões</button>',
        '<button type="button" class="din-quick" data-tab-jump="reports"><span>' + icon('reports') + '</span>Análise</button>',
        '<button type="button" class="din-quick" data-tab-jump="assistant"><span>' + icon('chat') + '</span>Din</button>',
      '</section>',
      '<div class="din-secondary-grid">',
        '<section class="din-small-panel" aria-label="Metas e orçamentos">',
          '<div class="din-section-heading"><h2>' + (state.scope === 'BUSINESS' ? 'Meta do negócio' : 'Metas e orçamento') + '</h2><button type="button" data-tab-jump="budget">Ver mais</button></div>',
          progressPanel(),
        '</section>',
        '<section class="din-small-panel din-tip">',
          '<div class="din-section-heading"><h2>Dica do Din</h2></div>',
          '<p>Separe um valor para imprevistos e acompanhe seus gastos ao longo do mês.</p>',
        '</section>',
      '</div>',
      '<section class="din-recent" aria-label="Últimas transações">',
        '<div class="din-section-heading"><h2>Últimas transações</h2><button type="button" data-tab-jump="transactions">Ver todas</button></div>',
        rows || '<p class="din-placeholder">Você ainda não tem transações neste perfil. Use “Nova transação” para começar.</p>',
      '</section>',
    '</div>',
  ].join('');
}
