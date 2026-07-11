import { dateFmt, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { paymentMetaForTransaction, scopedTransactions, transactionScope } from '../finance.js';
import { currentMonth, emptyState, transactionRow } from './shared.js';

export function transactionsView() {
  return `
    ${importStatementHtml()}
    ${recurringTransactionsHtml()}
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

function recurringTransactionsHtml() {
  const categoryOptions = state.categories
    .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
    .join('');
  const accountOptions = state.wallets
    .filter((account) => account.isActive !== false)
    .map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`)
    .join('');
  const activeRules = state.recurringTransactions.filter((rule) => rule.isActive !== false);
  const rules = activeRules.length
    ? `<div class="recurring-list">${activeRules.slice(0, 4).map(recurringRuleRow).join('')}</div>`
    : `<p class="import-summary">Nenhuma recorrencia ativa. Cadastre salario, aluguel, assinatura ou parcela.</p>`;
  const today = new Date().toISOString().slice(0, 10);
  const summary = state.recurringSummary
    ? `<p class="import-summary">${state.recurringSummary.created} lancamentos recorrentes gerados.</p>`
    : '';

  return `
    <section class="import-panel recurring-panel">
      <div class="recurring-header">
        <div>
          <strong>Transacoes recorrentes</strong>
          <span>Salario, aluguel, assinaturas e parcelas no automatico.</span>
        </div>
        <button class="button secondary" type="button" data-generate-recurring ${state.recurringLoading ? 'disabled' : ''}>
          ${state.recurringLoading ? 'Gerando...' : 'Gerar vencidas'}
        </button>
      </div>
      ${rules}
      <form class="import-form recurring-form" data-recurring-form>
        <input name="description" placeholder="Ex: Aluguel, Netflix, Salario" required />
        <input name="amount" inputmode="decimal" placeholder="Valor" required />
        <select name="type" aria-label="Tipo">
          <option value="EXPENSE">Gasto</option>
          <option value="INCOME">Receita</option>
        </select>
        <select name="categoryId" aria-label="Categoria" required>
          <option value="">Categoria</option>
          ${categoryOptions}
        </select>
        <select name="frequency" aria-label="Frequencia">
          <option value="MONTHLY">Mensal</option>
          <option value="WEEKLY">Semanal</option>
          <option value="YEARLY">Anual</option>
        </select>
        <input name="startDate" type="date" value="${today}" required />
        <select name="accountId" aria-label="Conta">
          <option value="">Sem conta vinculada</option>
          ${accountOptions}
        </select>
        <input name="maxOccurrences" inputmode="numeric" placeholder="Parcelas (opcional)" />
        <label class="recurring-check">
          <input name="generateFirst" type="checkbox" checked />
          <span>Gerar se ja estiver vencida</span>
        </label>
        <button class="button secondary" type="submit" ${state.recurringLoading ? 'disabled' : ''}>
          ${state.recurringLoading ? 'Salvando...' : 'Criar recorrencia'}
        </button>
      </form>
      ${summary}
    </section>
  `;
}

function recurringRuleRow(rule) {
  const category = state.categories.find((item) => item.id === rule.categoryId);
  const nextDate = rule.nextRunAt ? dateFmt.format(new Date(rule.nextRunAt)) : '--';
  const amount = money.format(Number(rule.amount || 0));
  const limit = rule.maxOccurrences ? ` · ${rule.generatedCount || 0}/${rule.maxOccurrences}` : '';
  return `
    <div class="recurring-row">
      <div>
        <strong>${escapeHtml(rule.description)}</strong>
        <span>${escapeHtml(category?.name || 'Categoria')} · ${frequencyLabel(rule.frequency)} · prox. ${nextDate}${limit}</span>
      </div>
      <div>
        <strong class="${rule.type === 'INCOME' ? 'income' : 'expense'}">${amount}</strong>
        <button type="button" data-recurring-delete="${rule.id}" aria-label="Desativar recorrencia">×</button>
      </div>
    </div>
  `;
}

function frequencyLabel(value) {
  if (value === 'WEEKLY') return 'semanal';
  if (value === 'YEARLY') return 'anual';
  return 'mensal';
}

function importStatementHtml() {
  const accountOptions = state.wallets
    .filter((account) => account.isActive !== false)
    .map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`)
    .join('');
  const categoryOptions = state.categories
    .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
    .join('');
  const summary = state.importCsvSummary
    ? `<p class="import-summary">${state.importCsvSummary.created} importadas, ${state.importCsvSummary.skipped} duplicadas ignoradas.</p>`
    : '';
  return `
    <section class="import-panel">
      <div class="import-header">
        <div>
          <strong>Importar e exportar</strong>
          <span>CSV com colunas data, descricao e valor. Backup do escopo atual quando precisar.</span>
        </div>
        <button class="button secondary" type="button" data-export-csv ${state.exportCsvLoading ? 'disabled' : ''}>
          ${state.exportCsvLoading ? 'Exportando...' : 'Exportar CSV'}
        </button>
      </div>
      <form class="import-form" data-import-csv-form>
        <select name="accountId" aria-label="Conta para conciliar">
          <option value="">Sem conta vinculada</option>
          ${accountOptions}
        </select>
        <select name="categoryId" aria-label="Categoria padrao">
          <option value="">Categorizar automaticamente</option>
          ${categoryOptions}
        </select>
        <input name="file" type="file" accept=".csv,text/csv" required />
        <button class="button secondary" type="submit" ${state.importCsvLoading ? 'disabled' : ''}>
          ${state.importCsvLoading ? 'Importando...' : 'Importar CSV'}
        </button>
      </form>
      ${summary}
    </section>
  `;
}
