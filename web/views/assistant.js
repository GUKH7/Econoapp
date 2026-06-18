import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTotals, totalsByCategory } from '../finance.js';
import { currentMonth, icon } from './shared.js';

export function assistantView() {
  const totals = scopedTotals();
  const topExpense = totalsByCategory('EXPENSE').sort((a, b) => b.total - a.total)[0];
  const balanceTone = totals.balance >= 0 ? 'positivo' : 'negativo';
  const topExpenseCopy = topExpense
    ? `${topExpense.name} concentra ${money.format(topExpense.total)} dos seus gastos em ${currentMonth}.`
    : `Ainda não há gastos suficientes para eu identificar uma categoria principal em ${currentMonth}.`;

  return `
    <section class="assistant-chat-screen">
      <div class="assistant-thread">
        <article class="chat-row bot">
          <span class="assistant-avatar">${icon('chat')}</span>
          <div class="chat-bubble">
            <strong>Olá, ${escapeHtml(state.user?.name?.split(' ')[0] || 'Gustavo')}!</strong>
            <p>Como posso te ajudar com suas finanças hoje?</p>
          </div>
        </article>

        <div class="quick-suggestions">
          <span>Sugestões rápidas</span>
          <button type="button" data-assistant-suggestion="Quanto gastei este mês?">Quanto gastei este mês?</button>
          <button type="button" data-assistant-suggestion="Registrar gasto">Registrar gasto</button>
          <button type="button" data-assistant-suggestion="Resumo do meu negócio">Resumo do meu negócio</button>
          <button type="button" data-assistant-suggestion="Minhas maiores despesas">Minhas maiores despesas</button>
        </div>

        <article class="chat-row user">
          <div class="chat-bubble">Como está meu mês?</div>
        </article>

        <article class="chat-row bot">
          <span class="assistant-avatar">${icon('chat')}</span>
          <div class="chat-bubble">
            <p>Seu resultado está ${balanceTone}: ${money.format(totals.balance)}.</p>
            <dl>
              <div><dt>Receitas</dt><dd>${money.format(totals.income)}</dd></div>
              <div><dt>Gastos</dt><dd>${money.format(totals.expense)}</dd></div>
              <div><dt>Principal ponto</dt><dd>${escapeHtml(topExpenseCopy)}</dd></div>
            </dl>
          </div>
        </article>
      </div>
      <form class="assistant-input" data-assistant-form>
        <input name="message" placeholder="Digite ou fale com o Din..." autocomplete="off" />
        <button type="submit" aria-label="Enviar mensagem">${icon('plus')}</button>
      </form>
    </section>
  `;
}
