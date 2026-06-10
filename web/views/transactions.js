import { state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { paymentMetaForTransaction, scopedTransactions, transactionScope } from '../finance.js';
import { currentMonth, emptyState, transactionRow } from './shared.js';

export function transactionsView() {
  return `
    <label class="search-field"><input type="search" placeholder="Buscar transações" value="${escapeHtml(state.transactionSearch)}" data-transaction-search /></label>
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
      transactionScope(transaction) === 'BUSINESS' ? 'negócio' : 'pessoal',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function transactionListHtml() {
  const rows = filteredTransactions().map(transactionRow).join('');
  return rows || emptyState('Nenhum lançamento encontrado', 'Ajuste a busca ou toque no + para adicionar um lançamento.', '+');
}
