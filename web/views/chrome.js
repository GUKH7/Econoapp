import { money, state } from '../state.js';
import { scopedTransactions } from '../finance.js';
import { currentMonth, icon } from './shared.js';

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
      <div class="month-title"><span>${currentMonth}</span><span>${scopedTransactions().length} lançamentos</span></div>
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
      <button class="fab-action" type="button" data-action-type="INCOME"><span class="row-icon income-bg">${icon('plus')}</span><span><strong>Nova receita</strong><small>Entrada pessoal ou do negócio</small></span></button>
      <button class="fab-action" type="button" data-action-type="EXPENSE"><span class="row-icon expense-bg">${icon('minus')}</span><span><strong>Novo gasto</strong><small>Despesa, compra ou taxa</small></span></button>
    </div>
  `;
}
