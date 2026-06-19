import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopeLabel, scopedTotals, scopedTransactions, totalsByCategory } from '../finance.js';
import { currentMonth, icon } from './shared.js';

export function assistantView() {
  const totals = scopedTotals();
  const transactions = scopedTransactions();
  const topExpense = totalsByCategory('EXPENSE').sort((a, b) => b.total - a.total)[0];
  const balanceTone = totals.balance >= 0 ? 'positivo' : 'negativo';
  const topExpensePercent =
    topExpense && totals.expense > 0 ? Math.round((topExpense.total / totals.expense) * 100) : 0;
  const topExpenseCopy = topExpense
    ? `${topExpense.name} concentra ${topExpensePercent}% dos seus gastos em ${currentMonth}.`
    : `Ainda não há gastos suficientes para eu identificar uma categoria principal em ${currentMonth}.`;
  const nextAction = nextBestAction(totals, topExpense, transactions.length);
  const conversationHtml = state.assistantMessages.length
    ? state.assistantMessages.map(assistantMessageHtml).join('')
    : '';
  const loadingHtml = state.assistantLoading
    ? `
        <article class="chat-row bot assistant-typing-row">
          <span class="assistant-avatar">${icon('chat')}</span>
          <div class="chat-bubble assistant-typing">
            <span></span><span></span><span></span>
          </div>
        </article>
      `
    : '';
  const errorHtml = state.assistantError
    ? `
        <article class="chat-row bot">
          <span class="assistant-avatar">${icon('chat')}</span>
          <div class="chat-bubble assistant-error">
            <strong>Não consegui responder agora</strong>
            <p>${escapeHtml(state.assistantError)}</p>
          </div>
        </article>
      `
    : '';

  return `
    <section class="assistant-chat-screen">
      <article class="assistant-hero-panel">
        <div class="assistant-hero-main">
          <span class="assistant-face">${icon('chat')}</span>
          <div>
            <span class="eyebrow">Din / Assistente</span>
            <h2>Olá, ${escapeHtml(state.user?.name?.split(' ')[0] || 'Gustavo')}</h2>
            <p>Eu te ajudo a registrar lançamentos, entender gastos e enxergar o que merece atenção.</p>
          </div>
        </div>
        <span class="status-badge connected">${scopeLabel()}</span>
      </article>

      <div class="assistant-digest">
        <article>
          <span>Resultado</span>
          <strong class="${totals.balance >= 0 ? 'income' : 'expense'}">${money.format(totals.balance)}</strong>
        </article>
        <article>
          <span>Receitas</span>
          <strong class="income">${money.format(totals.income)}</strong>
        </article>
        <article>
          <span>Gastos</span>
          <strong class="expense">${money.format(totals.expense)}</strong>
        </article>
      </div>

      <div class="assistant-thread">
        <article class="chat-row bot">
          <span class="assistant-avatar">${icon('chat')}</span>
          <div class="chat-bubble">
            <strong>Leitura rápida de ${currentMonth}</strong>
            <p>Seu resultado está ${balanceTone}: ${money.format(totals.balance)}. ${escapeHtml(topExpenseCopy)}</p>
          </div>
        </article>

        <div class="quick-suggestions">
          <span>Sugestões rápidas</span>
          <button type="button" data-assistant-message="Quanto gastei este mês?">Quanto gastei este mês?</button>
          <button type="button" data-assistant-action="expense">Registrar gasto</button>
          <button type="button" data-assistant-action="income">Registrar receita</button>
          <button type="button" data-assistant-message="Resumo do meu negócio">Resumo do negócio</button>
        </div>

        <article class="chat-row bot">
          <span class="assistant-avatar">${icon('chat')}</span>
          <div class="chat-bubble">
            <strong>Próximo passo sugerido</strong>
            <p>${escapeHtml(nextAction.copy)}</p>
            <dl>
              <div><dt>Melhor ação</dt><dd>${escapeHtml(nextAction.title)}</dd></div>
              <div><dt>Base usada</dt><dd>${transactions.length} lançamentos em ${currentMonth}</dd></div>
            </dl>
            <button class="assistant-inline-action" type="button" data-assistant-action="${nextAction.action}">
              ${escapeHtml(nextAction.button)}
            </button>
          </div>
        </article>
        ${conversationHtml}
        ${loadingHtml}
        ${errorHtml}
      </div>
    </section>
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
