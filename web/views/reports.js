import { colors, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopeLabel } from '../finance.js';
import {
  categoryRows,
  changeText,
  comparisonText,
  currentMonth,
  emptyState,
  icon,
  nextMonth,
  percentChange,
  previousMonth,
  scopedTransactionsForMonth,
  totalsByCategoryForTransactions,
  totalsForTransactions,
} from './shared.js';

export function reportsView() {
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
    ? `${topCategory.name} representa ${topPercent}% de ${reportLabel.toLowerCase()} no período.`
    : `Sem ${reportLabel.toLowerCase()} para analisar neste período.`;
  const balanceInsight =
    currentTotals.balance >= 0
      ? `Resultado positivo de ${money.format(currentTotals.balance)} em ${currentMonth}.`
      : `Resultado negativo de ${money.format(Math.abs(currentTotals.balance))}; vale revisar gastos recorrentes.`;
  const expenseInsight =
    previousTotals.expense <= 0 && currentTotals.expense > 0
      ? `Gastos registrados em ${currentMonth}, ainda sem base de comparação com ${previousMonth}.`
      : currentTotals.expense > previousTotals.expense
        ? `Gastos subiram ${Math.abs(percentChange(currentTotals.expense, previousTotals.expense))}% contra ${previousMonth}.`
        : `Gastos ficaram ${Math.abs(percentChange(currentTotals.expense, previousTotals.expense))}% abaixo de ${previousMonth}.`;
  const incomeInsight =
    previousTotals.income <= 0 && currentTotals.income > 0
      ? `Receitas registradas em ${currentMonth}, ainda sem base de comparação com ${previousMonth}.`
      : currentTotals.income >= previousTotals.income
        ? `Receitas evoluíram ${Math.abs(percentChange(currentTotals.income, previousTotals.income))}% no comparativo mensal.`
        : `Receitas caíram ${Math.abs(percentChange(currentTotals.income, previousTotals.income))}% no comparativo mensal.`;
  const spendingByTime = state.dashboard?.spendingByTime;
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
        <strong>Insight do período</strong>
        <p>${escapeHtml(reportInsight)}</p>
      </div>
    </article>
    <article class="card report-advice">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Leitura rápida</span>
          <h2>O que observar</h2>
          <p class="report-advice-summary">${escapeHtml(balanceInsight)}</p>
        </div>
      </div>
      <div class="advice-list">
        <div><span class="row-icon income-bg">${icon('reports')}</span><p>${escapeHtml(incomeInsight)}</p></div>
        <div><span class="row-icon expense-bg">${icon('target')}</span><p>${escapeHtml(expenseInsight)}</p></div>
      </div>
    </article>
    ${reportType === 'EXPENSE' ? spendingTimeReport(spendingByTime) : ''}
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
        ${
          categoryRows(categories, reportTotal) ||
          emptyState(
            `Sem ${reportLabel.toLowerCase()} em ${currentMonth}`,
            `Registre ${reportType === 'INCOME' ? 'uma receita' : 'um gasto'} para o Din montar esse relatório por categoria.`,
            icon(reportType === 'INCOME' ? 'plus' : 'minus'),
            {
              label: reportType === 'INCOME' ? 'Registrar receita' : 'Registrar gasto',
              attrs: `data-assistant-action="${reportType === 'INCOME' ? 'income' : 'expense'}"`,
            },
          )
        }
      </article>
    </div>
  `;
}

function spendingTimeReport(report) {
  if (!report?.sampleSize) {
    return `<article class="card time-report">
      <span class="eyebrow">Comportamento</span>
      <h2>Quando você mais gasta</h2>
      <p>Ainda não há gastos com horário suficiente para identificar um padrão.</p>
    </article>`;
  }
  const peak = report.periods.find((period) => period.key === report.peakPeriod);
  const insight = report.hasEnoughData && peak
    ? `Você costuma gastar mais à ${peak.label.toLowerCase()}, principalmente com ${peak.topCategory || 'gastos diversos'}.`
    : `Já analisamos ${report.sampleSize} gastos, mas precisamos de pelo menos 5 para indicar um hábito com segurança.`;
  return `<article class="card time-report">
    <div class="panel-title"><div>
      <span class="eyebrow">Comportamento</span>
      <h2>Quando você mais gasta</h2>
      <p>${escapeHtml(insight)}</p>
    </div></div>
    <div class="time-report-list">
      ${report.periods.map((period) => `<div class="time-report-row ${period.key === report.peakPeriod ? 'active' : ''}">
        <div><strong>${escapeHtml(period.label)}</strong><small>${escapeHtml(period.range)} · ${period.transactionCount} ${period.transactionCount === 1 ? 'gasto' : 'gastos'}</small></div>
        <div class="time-report-value"><strong>${money.format(period.total)}</strong><small>${period.percentage}%${period.topCategory ? ` · ${escapeHtml(period.topCategory)}` : ''}</small></div>
      </div>`).join('')}
    </div>
    <small class="time-report-note">Importações CSV e lançamentos recorrentes não entram nesta análise de horário.</small>
  </article>`;
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
