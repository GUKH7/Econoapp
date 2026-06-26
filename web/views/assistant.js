import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopeLabel, scopedTotals, scopedTransactions, totalsByCategory } from '../finance.js';
import { icon } from './shared.js';

export function assistantView() {
  const totals = scopedTotals();
  const transactions = scopedTransactions();
  const topExpense = totalsByCategory('EXPENSE').sort((a, b) => b.total - a.total)[0];
  const suggestions = assistantSuggestions(totals, topExpense);
  const historyHtml = state.assistantMessages.length
    ? state.assistantMessages.map(assistantMessageHtml).join('')
    : emptyHistoryHtml();

  return `
    <section class="assistant-chat-screen assistant-chat-focused">
      <article class="assistant-command-panel">
        <div class="assistant-command-head">
          <span class="assistant-face">${icon('chat')}</span>
          <div>
            <span class="eyebrow">Din / Assistente</span>
            <h2>Olá, ${escapeHtml(state.user?.name?.split(' ')[0] || 'Gustavo')}</h2>
            <p>${assistantIntro(totals, topExpense)}</p>
          </div>
        </div>
        <div class="assistant-command-meta">
          <span>${scopeLabel()}</span>
          <strong>${transactions.length} lançamentos</strong>
        </div>
        <div class="assistant-suggestion-list compact-inline" aria-label="Sugestões rápidas">
          ${suggestions
            .map((suggestion) => `<button type="button" data-assistant-message="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`)
            .join('')}
        </div>
      </article>

      <section class="assistant-history-card">
        <div class="panel-title compact">
          <div>
            <span class="eyebrow">Histórico</span>
            <h2>Conversa com o Din</h2>
          </div>
          <small>${state.assistantMessages.length ? `${state.assistantMessages.length} mensagens` : 'Pronto para começar'}</small>
        </div>
        <div class="assistant-thread">
          ${historyHtml}
          ${assistantLoadingHtml()}
          ${assistantErrorHtml()}
        </div>
      </section>
    </section>
  `;
}

function assistantIntro(totals, topExpense) {
  if (!scopedTransactions().length) {
    return 'Me conte uma entrada ou gasto para começar seu histórico financeiro.';
  }
  if (totals.balance < 0) {
    return `Seu resultado está negativo em ${money.format(Math.abs(totals.balance))}. Posso ajudar a encontrar onde ajustar.`;
  }
  if (topExpense) {
    return `${topExpense.name} é o ponto de maior atenção agora. Posso detalhar ou comparar.`;
  }
  return 'Pergunte sobre saldo, gastos, receitas, limites ou peça para registrar um lançamento.';
}

function assistantSuggestions(totals, topExpense) {
  const base = [
    'Quanto gastei este mês?',
    'Registrar gasto de R$ 40 no mercado',
    'Registrar receita de R$ 250 de uma venda',
    'Compare este mês com o anterior',
  ];

  if (state.scope === 'BUSINESS') {
    return ['Resumo do meu negócio', 'Quanto vendi este mês?', 'Quais canais venderam mais?', ...base.slice(0, 2)];
  }

  if (topExpense) {
    return [
      `Por que ${topExpense.name} está alto?`,
      `Quanto gastei com ${topExpense.name}?`,
      'Defina um limite para minha maior categoria',
      ...base.slice(0, 3),
    ];
  }

  if (totals.income <= 0) {
    return ['Registrar minha primeira receita', 'Criar uma carteira chamada Dinheiro', ...base];
  }

  return base;
}

function assistantLoadingHtml() {
  if (!state.assistantLoading) return '';
  return `
    <article class="chat-row bot assistant-typing-row">
      <span class="assistant-avatar">${icon('chat')}</span>
      <div class="chat-bubble assistant-typing">
        <span></span><span></span><span></span>
      </div>
    </article>
  `;
}

function assistantErrorHtml() {
  if (!state.assistantError) return '';
  return `
    <article class="chat-row bot">
      <span class="assistant-avatar">${icon('chat')}</span>
      <div class="chat-bubble assistant-error">
        <strong>Não consegui responder agora</strong>
        <p>${escapeHtml(state.assistantError)}</p>
      </div>
    </article>
  `;
}

function emptyHistoryHtml() {
  return `
    <article class="chat-row bot">
      <span class="assistant-avatar">${icon('chat')}</span>
      <div class="chat-bubble">
        <strong>Como posso ajudar hoje?</strong>
        <p>Você pode perguntar sobre saldo, gastos, receitas, limites ou pedir para registrar algo em linguagem natural.</p>
      </div>
    </article>
  `;
}

function assistantMessageHtml(message) {
  const role = message.role === 'user' ? 'user' : 'bot';
  return `
    <article class="chat-row ${role}">
      ${role === 'bot' ? `<span class="assistant-avatar">${icon('chat')}</span>` : ''}
      <div class="chat-bubble">
        <p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>
      </div>
    </article>
  `;
}
