import { dateFmt, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { paymentMetaForTransaction, scopedTransactions, transactionScope } from '../finance.js';
import { currentMonth, emptyState, transactionRow } from './shared.js';

export function transactionsView() {
  return `
    <label class="search-field"><input type="search" placeholder="Buscar lançamento" value="${escapeHtml(state.transactionSearch)}" data-transaction-search /></label>
    <div class="filter-chips">
      ${transactionFilterButton('ALL', 'Todos')}
      ${transactionFilterButton('INCOME', 'Receitas')}
      ${transactionFilterButton('EXPENSE', 'Gastos')}
      ${transactionFilterButton('TRANSFER', 'Transferências')}
    </div>
    <div class="period-switch">
      <button type="button">Maio</button>
      <button class="active" type="button">${currentMonth}</button>
      <button type="button">Julho</button>
    </div>
    <section class="timeline-list" data-transaction-list>
      ${transactionListHtml()}
    </section>
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
  const transactions = filteredTransactions();
  if (!transactions.length) {
    const isFiltered = state.transactionSearch.trim() || state.transactionFilter !== 'ALL';
    return emptyState(
      isFiltered ? 'Nada encontrado nesse filtro' : 'Seu fluxo ainda está vazio',
      isFiltered
        ? 'Tente buscar por outro termo ou volte para todos os lançamentos.'
        : 'Registre uma receita ou gasto para acompanhar seu dinheiro por data.',
      '+',
      isFiltered
        ? { label: 'Ver todos', attrs: 'data-clear-transaction-filters' }
        : { label: 'Novo lançamento', attrs: 'data-assistant-action="expense"' },
    );
  }

  const groups = new Map();
  transactions.forEach((transaction) => {
    const label = dateGroupLabel(transaction.date);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(transaction);
  });

  return [...groups.entries()]
    .map(
      ([label, rows]) => `
        <section class="timeline-group">
          <h2>${escapeHtml(label)}</h2>
          <article class="timeline-card">${rows.map(transactionRow).join('')}</article>
        </section>
      `,
    )
    .join('');
}

function dateGroupLabel(dateValue) {
  const date = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return dateFmt.format(date);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
