import { dateFmt, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { paymentMetaForTransaction, scopedTransactions, transactionScope } from '../finance.js';

const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date());
export const currentMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
const previousMonthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
  new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
);
export const previousMonth = previousMonthLabel.charAt(0).toUpperCase() + previousMonthLabel.slice(1);
const nextMonthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
  new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
);
export const nextMonth = nextMonthLabel.charAt(0).toUpperCase() + nextMonthLabel.slice(1);

export function transactionValue(transaction) {
  return Number(transaction.netAmount || transaction.amount || 0);
}

export function transactionMonthKey(transaction) {
  const date = new Date(transaction.date);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKey(offset = 0) {
  const date = new Date();
  date.setMonth(date.getMonth() + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function totalsForTransactions(transactions) {
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

export function scopedTransactionsForMonth(offset = 0) {
  const key = monthKey(offset);
  return scopedTransactions().filter((transaction) => transactionMonthKey(transaction) === key);
}

export function totalsByCategoryForTransactions(type, transactions) {
  const byId = new Map(state.categories.map((category) => [category.id, { ...category, total: 0 }]));
  transactions
    .filter((transaction) => transaction.type === type)
    .forEach((transaction) => {
      const category = byId.get(transaction.categoryId);
      if (category) category.total += transactionValue(transaction);
    });
  return [...byId.values()].filter((category) => category.total > 0);
}

export function percentChange(current, previous) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function changeText(current, previous, kind = 'neutral') {
  if (previous <= 0 && current > 0) return 'Sem base no mês anterior';
  const change = percentChange(current, previous);
  if (current === previous) return 'Estável vs mês anterior';
  const direction = change > 0 ? 'acima' : 'abaixo';
  const prefix = kind === 'expense' && change > 0 ? 'Atenção: ' : '';
  return `${prefix}${Math.abs(change)}% ${direction} do mês anterior`;
}

export function comparisonText(current, previous, label) {
  if (previous <= 0 && current > 0) return `${label} sem base em ${previousMonth}`;
  const change = percentChange(current, previous);
  return `${change >= 0 ? '+' : ''}${change}% vs ${previousMonth}`;
}

export function icon(name) {
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
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v3h6V2h2v3h3a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3V2Zm13 8H4v10h16V10Z"/></svg>',
  };
  return icons[name] || icons.more;
}

export function emptyState(title, copy, icon, action = null) {
  const actionHtml = action
    ? `<button class="button secondary empty-action" type="button" ${action.attrs || ''}>${escapeHtml(action.label)}</button>`
    : '';
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>
      ${actionHtml}
    </div>
  `;
}

export function categoryRows(items, total = 0) {
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

export function transactionRow(transaction) {
  const value = Number(transaction.netAmount || transaction.amount || 0);
  const typeClass = transaction.type === 'EXPENSE' ? 'expense' : 'income';
  const category = state.categories.find((item) => item.id === transaction.categoryId);
  const payment = paymentMetaForTransaction(transaction);
  const iconText = transaction.type === 'EXPENSE' ? '-' : '+';
  const iconColor = transaction.type === 'EXPENSE' ? '#EF4444' : '#22C55E';
  const paymentLabel = payment ? ` - ${escapeHtml(payment.label)}` : '';
  return `
    <div class="row transaction-row">
      <div class="transaction-main">
        <span class="row-icon" style="background:${category?.color || iconColor}">${iconText}</span>
        <div>
          <div class="row-title">${escapeHtml(transaction.description)}</div>
          <div class="row-meta">${dateFmt.format(new Date(transaction.date))} - ${category?.name || transaction.source}${paymentLabel} - ${transactionScope(transaction) === 'BUSINESS' ? 'Negócio' : 'Pessoal'}</div>
        </div>
      </div>
      <strong class="${typeClass}">${money.format(value)}</strong>
    </div>
  `;
}
