import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopeLabel, scopedTotals, scopedTransactions, totalsByCategory } from '../finance.js';
import { currentMonth, icon, transactionValue } from './shared.js';

export function assistantView() {
  const totals = scopedTotals();
  const transactions = scopedTransactions();
  const recentTransactions = transactions.slice(0, 5);
  const topExpense = totalsByCategory('EXPENSE').sort((a, b) => b.total - a.total)[0];
  const nextAction = nextBestAction(totals, topExpense, transactions.length);
  const suggestions = assistantSuggestions(totals, topExpense);
  const historyHtml = state.assistantMessages.length
    ? state.assistantMessages.map(assistantMessageHtml).join('')
    : emptyHistoryHtml();

  return `
    <section class="assistant-chat-screen">
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
          <strong>${currentMonth}</strong>
        </div>
      </article>

      <div class="assistant-summary-strip">
        ${summaryTile('Resultado', totals.balance, totals.balance >= 0 ? 'income' : 'expense')}
        ${summaryTile('Receitas', totals.income, 'income')}
        ${summaryTile('Gastos', totals.expense, 'expense')}
      </div>

      <section class="assistant-action-grid" aria-label="Ações rápidas do Din">
        ${quickAction('expense', 'Registrar gasto', 'Compra, conta ou saída', 'minus')}
        ${quickAction('income', 'Registrar receita', 'Venda, salário ou entrada', 'plus')}
        ${quickAction('wallet', 'Criar carteira', 'Banco, Pix ou dinheiro', 'wallet')}
        ${quickAction('budget', 'Definir limite', 'Orçamento mensal', 'target')}
      </section>

      <article class="assistant-next-card">
        <span class="assistant-avatar">${icon('chat')}</span>
        <div>
          <small>Próximo passo sugerido</small>
          <strong>${escapeHtml(nextAction.title)}</strong>
          <p>${escapeHtml(nextAction.copy)}</p>
          <button type="button" data-assistant-action="${nextAction.action}">${escapeHtml(nextAction.button)}</button>
        </div>
      </article>

      <section class="assistant-suggestions-panel">
        <div class="panel-title compact">
          <div>
            <span class="eyebrow">Sugestões</span>
            <h2>Perguntas úteis</h2>
          </div>
        </div>
        <div class="assistant-suggestion-list">
          ${suggestions
            .map((suggestion) => `<button type="button" data-assistant-message="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`)
            .join('')}
        </div>
      </section>

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

      <section class="assistant-recent-context">
        <div class="panel-title compact">
          <div>
            <span class="eyebrow">Contexto usado</span>
            <h2>Últimos lançamentos</h2>
          </div>
        </div>
        ${
          recentTransactions.length
            ? recentTransactions.map(recentTransactionHtml).join('')
            : '<p class="empty">Registre alguns lançamentos para o Din gerar respostas mais precisas.</p>'
        }
      </section>
    </section>
  `;
}

function summaryTile(label, value, tone) {
  return `
    <article>
      <span>${label}</span>
      <strong class="${tone}">${money.format(value)}</strong>
    </article>
  `;
}

function quickAction(action, title, copy, iconName) {
  return `
    <button type="button" data-assistant-action="${action}">
      <span>${icon(iconName)}</span>
      <strong>${title}</strong>
      <small>${copy}</small>
    </button>
  `;
}

function assistantIntro(totals, topExpense) {
  if (!scopedTransactions().length) {
    return 'Me conte uma entrada ou gasto, ou use uma ação rápida para começar seu histórico financeiro.';
  }
  if (totals.balance < 0) {
    return `Seu resultado está negativo em ${money.format(Math.abs(totals.balance))}. Posso ajudar a encontrar onde ajustar.`;
  }
  if (topExpense) {
    return `${topExpense.name} é o ponto de maior atenção agora. Posso detalhar, comparar ou registrar algo novo.`;
  }
  return 'Estou acompanhando seu mês e posso responder dúvidas, registrar lançamentos e organizar contas.';
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

function recentTransactionHtml(transaction) {
  const value = transactionValue(transaction);
  const tone = transaction.type === 'EXPENSE' ? 'expense' : 'income';
  return `
    <div class="assistant-context-row">
      <span class="row-icon ${transaction.type === 'EXPENSE' ? 'expense-bg' : 'income-bg'}">${transaction.type === 'EXPENSE' ? '-' : '+'}</span>
      <div>
        <strong>${escapeHtml(transaction.description)}</strong>
        <small>${transaction.type === 'EXPENSE' ? 'Gasto' : 'Receita'} em ${scopeLabel()}</small>
      </div>
      <b class="${tone}">${money.format(value)}</b>
    </div>
  `;
}

function nextBestAction(totals, topExpense, transactionCount) {
  if (!transactionCount) {
    return {
      action: 'expense',
      button: 'Criar lançamento',
      copy: 'Comece registrando uma receita ou gasto. Com alguns dados eu passo a detectar padrões e oportunidades.',
      title: 'Registrar o primeiro lançamento',
    };
  }

  if (state.scope === 'PERSONAL' && totals.expense > 0 && !Number(state.budgets[state.scope] || 0)) {
    return {
      action: 'budget',
      button: 'Definir limite',
      copy: 'Você já tem gastos no mês, mas ainda não tem um limite geral. Um teto ajuda a saber se o ritmo está saudável.',
      title: 'Definir um limite mensal',
    };
  }

  if (state.scope === 'BUSINESS' && !state.channels.length) {
    return {
      action: 'channels',
      button: 'Criar canal',
      copy: 'No negócio, separar vendas por canal ajuda a entender onde você fatura mais e onde as taxas pesam.',
      title: 'Organizar canais de venda',
    };
  }

  if (topExpense) {
    return {
      action: 'reports',
      button: 'Ver análise',
      copy: `${topExpense.name} é sua maior categoria agora. Vale abrir os relatórios para comparar com receitas e saldo.`,
      title: 'Analisar maior categoria',
    };
  }

  return {
    action: 'income',
    button: 'Registrar receita',
    copy: 'Continue registrando entradas e gastos. Quanto mais completo o histórico, melhores ficam meus insights.',
    title: 'Completar histórico',
  };
}
