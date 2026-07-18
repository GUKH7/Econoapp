import { colors, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopeLabel } from '../finance.js';
import {
  categoryRows,
  changeText,
  comparisonText,
  emptyState,
  icon,
  percentChange,
} from './shared.js';

export function reportsView() {
  if (state.scope === 'BUSINESS') return businessReportsView();
  const reportType = state.reportType || 'EXPENSE';
  const report = state.report;
  if (!report) {
    return `<article class="card report-panel"><span class="eyebrow">Análise</span><h2>${state.reportLoading ? 'Carregando relatório...' : 'Relatório indisponível'}</h2><p>${state.reportLoading ? 'O Din está consolidando seus dados.' : 'Tente atualizar seus dados para carregar este período.'}</p></article>`;
  }
  const currentTotals = report.current;
  const previousTotals = report.previous;
  const categories = report.categories?.[reportType] || [];
  const selectedMonth = monthLabel(report.period.startDate);
  const comparisonMonth = monthLabel(report.comparisonPeriod.startDate);
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
      ? `Resultado positivo de ${money.format(currentTotals.balance)} em ${selectedMonth}.`
      : `Resultado negativo de ${money.format(Math.abs(currentTotals.balance))}; vale revisar gastos recorrentes.`;
  const expenseInsight =
    previousTotals.expense <= 0 && currentTotals.expense > 0
      ? `Gastos registrados em ${selectedMonth}, ainda sem base de comparação com ${comparisonMonth}.`
      : currentTotals.expense > previousTotals.expense
        ? `Gastos subiram ${Math.abs(percentChange(currentTotals.expense, previousTotals.expense))}% contra ${comparisonMonth}.`
        : `Gastos ficaram ${Math.abs(percentChange(currentTotals.expense, previousTotals.expense))}% abaixo de ${comparisonMonth}.`;
  const incomeInsight =
    previousTotals.income <= 0 && currentTotals.income > 0
      ? `Receitas registradas em ${selectedMonth}, ainda sem base de comparação com ${comparisonMonth}.`
      : currentTotals.income >= previousTotals.income
        ? `Receitas evoluíram ${Math.abs(percentChange(currentTotals.income, previousTotals.income))}% no comparativo mensal.`
        : `Receitas caíram ${Math.abs(percentChange(currentTotals.income, previousTotals.income))}% no comparativo mensal.`;
  const spendingByTime = report.spendingByTime;
  const selectedOffset = state.reportPeriodOffset || 0;
  return `
    <div class="report-tabs">
      ${reportTab('EXPENSE', 'Gastos')}
      ${reportTab('INCOME', 'Receitas')}
    </div>
    <div class="period-switch">
      <button type="button" data-report-period="${selectedOffset - 1}" ${state.reportLoading ? 'disabled' : ''}>${monthLabelForOffset(selectedOffset - 1)}</button>
      <button class="active" type="button" data-report-period="${selectedOffset}" aria-pressed="true">${selectedMonth}</button>
      <button type="button" data-report-period="${selectedOffset + 1}" ${state.reportLoading ? 'disabled' : ''}>${monthLabelForOffset(selectedOffset + 1)}</button>
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
        <h2>${reportLabel} em ${selectedMonth}</h2>
        <p>${comparisonText(reportTotal, previousSelectedTotal, reportLabel, comparisonMonth)}</p>
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
            `Sem ${reportLabel.toLowerCase()} em ${selectedMonth}`,
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

function businessReportsView() {
  const report = state.businessReport;
  if (!report) return `<article class="card report-panel"><span class="eyebrow">Relatórios empresariais</span><h2>${state.reportLoading ? 'Consolidando dados...' : 'Relatório indisponível'}</h2><p>Tente atualizar este período.</p></article>`;
  const selectedOffset = state.reportPeriodOffset || 0;
  const selectedMonth = monthLabel(report.period.startDate);
  const dre = report.incomeStatement;
  const forecast = report.forecast;
  const comparison = report.monthlyComparison;
  const compositionTotal = Number(report.expenseComposition.fixed || 0) + Number(report.expenseComposition.variable || 0) + Number(report.expenseComposition.unclassified || 0);
  return `
    <div class="period-switch">
      <button type="button" data-report-period="${selectedOffset - 1}">${monthLabelForOffset(selectedOffset - 1)}</button>
      <button class="active" type="button" data-report-period="${selectedOffset}">${selectedMonth}</button>
      <button type="button" data-report-period="${selectedOffset + 1}">${monthLabelForOffset(selectedOffset + 1)}</button>
    </div>
    <div class="business-report-actions"><button class="button secondary" type="button" data-business-report-export="pdf">Exportar PDF</button><button class="button secondary" type="button" data-business-report-export="csv">Exportar CSV</button></div>
    <article class="card business-report-hero"><span class="eyebrow">Previsão do mês</span><h2>${money.format(Number(forecast.estimatedClosingResult || 0))}</h2><p>Resultado realizado ${money.format(Number(forecast.realizedResult || 0))} · a receber ${money.format(Number(forecast.pendingReceivable || 0))} · a pagar ${money.format(Number(forecast.pendingPayable || 0))}</p>${Number(report.profile?.revenueGoal || 0) > 0 ? `<div class="business-report-goal"><span>Meta de faturamento</span><strong>${Number(report.profile.revenueGoalProgress || 0)}%</strong><i><b style="width:${Math.min(100, Number(report.profile.revenueGoalProgress || 0))}%"></b></i><small>Faltam ${money.format(Number(report.profile.revenueGoalGap || 0))} para ${money.format(Number(report.profile.revenueGoal || 0))}</small></div>` : ''}</article>
    <div class="business-report-grid">
      <article class="card business-report-section"><span class="eyebrow">DRE simplificado</span><h2>Resultado do período</h2>${reportRows([
        ['Faturamento bruto', dre.grossRevenue], ['Taxas dos canais', -dre.channelFees], ['Faturamento líquido', dre.netRevenue], ['Custos variáveis', -dre.variableExpenses], ['Despesas fixas', -dre.fixedExpenses], ['Provisão de impostos', -dre.taxProvision], ['Resultado', dre.result],
      ])}</article>
      <article class="card business-report-section"><span class="eyebrow">Comparativo mensal</span><h2>Atual versus anterior</h2>${reportRows([['Receitas atuais', comparison.current.income], ['Receitas anteriores', comparison.previous.income], ['Despesas atuais', -comparison.current.expense], ['Despesas anteriores', -comparison.previous.expense], ['Resultado atual', comparison.current.result], ['Resultado anterior', comparison.previous.result]])}<p class="report-change">Receitas: ${changeLabel(comparison.incomeChange)} · Despesas: ${changeLabel(comparison.expenseChange)}</p></article>
    </div>
    <article class="card business-report-section"><span class="eyebrow">Fluxo de caixa</span><h2>Entradas e saídas por dia</h2><div class="business-report-table">${report.cashFlow.rows.length ? report.cashFlow.rows.map((row) => `<div><span>${escapeHtml(row.date)}</span><small class="income">+ ${money.format(Number(row.income))}</small><small class="expense">- ${money.format(Number(row.expense))}</small><strong>${money.format(Number(row.net))}</strong></div>`).join('') : '<p class="empty">Sem movimentações no período.</p>'}</div></article>
    <div class="business-report-grid">
      ${rankingCard('Receitas por cliente', report.revenueByClient)}
      ${rankingCard('Receitas por canal', report.revenueByChannel)}
    </div>
    <article class="card business-report-section"><span class="eyebrow">Produtos e serviços</span><h2>Receita e margem</h2><div class="business-report-table">${report.revenueByProduct.length ? report.revenueByProduct.map((item) => `<div><span>${escapeHtml(item.name)}<small>${Number(item.quantity).toLocaleString('pt-BR')} vendidos</small></span><small>${money.format(Number(item.netRevenue))}</small><small>Custo ${money.format(Number(item.estimatedCost))}</small><strong>${money.format(Number(item.margin))}</strong></div>`).join('') : '<p class="empty">Nenhuma venda vinculada a produtos.</p>'}</div></article>
    <article class="card business-report-section"><span class="eyebrow">Despesas</span><h2>Fixas versus variáveis</h2><div class="expense-composition-bars">${compositionBar('Fixas', report.expenseComposition.fixed, compositionTotal, '#0f766e')}${compositionBar('Variáveis', report.expenseComposition.variable, compositionTotal, '#f59e0b')}${compositionBar('Sem classificação', report.expenseComposition.unclassified, compositionTotal, '#ef4444')}</div></article>
    <div class="business-report-grid">
      ${timingCard('Dias com mais vendas', report.salesTiming.byDay)}
      ${timingCard('Horários com mais vendas', report.salesTiming.byHour)}
    </div>`;
}

function reportRows(rows) {
  return `<div class="business-report-rows">${rows.map(([label, value], index) => `<div class="${index === rows.length - 1 ? 'total' : ''}"><span>${escapeHtml(label)}</span><strong>${money.format(Number(value || 0))}</strong></div>`).join('')}</div>`;
}

function rankingCard(title, items) {
  return `<article class="card business-report-section"><span class="eyebrow">Receitas</span><h2>${title}</h2><div class="business-ranking">${items.length ? items.slice(0, 8).map((item, index) => `<div><span>${index + 1}. ${escapeHtml(item.name)}</span><strong>${money.format(Number(item.revenue))}</strong></div>`).join('') : '<p class="empty">Sem dados no período.</p>'}</div></article>`;
}

function timingCard(title, items) {
  return `<article class="card business-report-section"><span class="eyebrow">Padrões de venda</span><h2>${title}</h2><div class="business-ranking">${items.length ? items.slice(0, 8).map((item) => `<div><span>${escapeHtml(item.label)}<small>${item.sales} vendas</small></span><strong>${money.format(Number(item.revenue))}</strong></div>`).join('') : '<p class="empty">Sem vendas com horário no período.</p>'}</div></article>`;
}

function compositionBar(label, value, total, color) {
  const percentage = total > 0 ? Math.round(Number(value || 0) / total * 100) : 0;
  return `<div><span>${label}<strong>${money.format(Number(value || 0))} · ${percentage}%</strong></span><i><b style="width:${percentage}%;background:${color}"></b></i></div>`;
}

function changeLabel(value) {
  if (value === null) return 'sem base anterior';
  return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
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

function monthLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthLabelForOffset(offset) {
  const now = new Date();
  return monthLabel(`${new Date(now.getFullYear(), now.getMonth() + offset, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() + offset, 1).getMonth() + 1).padStart(2, '0')}-01`);
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
