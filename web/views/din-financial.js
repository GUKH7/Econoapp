import { money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTransactions, transactionScope } from '../finance.js';

const finiteAmount = (input) => {
  const amount = Number(input);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const clampPercent = (value) => Math.max(0, Math.min(100, value));
const monthKey = (date) => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');

export function cardsView() {
  const cards = (state.cards || []).filter((card) => !card.scope || card.scope === state.scope);
  const combinedLimit = cards.reduce((sum, card) => sum + finiteAmount(card.limit), 0);
  const combinedBill = cards.reduce((sum, card) => sum + finiteAmount(card.currentBill), 0);
  return \`
    <section class="din-finance-page din-cards-page" aria-label="Seus cartões">
      <p class="din-finance-intro">Acompanhe seus cartões de crédito e as faturas informadas. Os valores refletem os dados cadastrados no Din.</p>
      <div class="din-finance-overview">
        <div><span>Limite cadastrado</span><strong>\${money.format(combinedLimit)}</strong></div>
        <div><span>Faturas informadas</span><strong>\${money.format(combinedBill)}</strong></div>
      </div>
      <div class="din-finance-heading"><h2>Meus cartões</h2><span>\${cards.length} \${cards.length === 1 ? 'cartão' : 'cartões'}</span></div>
      <div class="din-cards-list">
        \${cards.length ? cards.map((card) => {
          const limit = finiteAmount(card.limit);
          const bill = finiteAmount(card.currentBill);
          const ratio = limit ? clampPercent(Math.round((bill / limit) * 100)) : 0;
          return \`<article class="din-card-item">
            <div class="din-card-top"><span class="din-card-chip" aria-hidden="true">▦</span><span>Crédito · \${state.scope === 'BUSINESS' ? 'Empresarial' : 'Pessoal'}</span></div>
            <h3>\${escapeHtml(card.name)}</h3>
            <div class="din-card-values"><div><small>Fatura informada</small><strong>\${money.format(bill)}</strong></div><div><small>Limite cadastrado</small><strong>\${money.format(limit)}</strong></div></div>
            \${limit ? \`<div class="din-track" role="progressbar" aria-label="Fatura em relação ao limite" aria-valuemin="0" aria-valuemax="100" aria-valuenow="\${ratio}"><span style="width:\${ratio}%"></span></div>\` : ''}
            <p class="din-finance-note">Os valores podem não refletir compras ou pagamentos ainda não registrados.</p>
          </article>\`;
        }).join('') : '<p class="din-empty">Nenhum cartão cadastrado neste perfil. Adicione seu primeiro cartão abaixo.</p>'}
      </div>
      <article class="din-finance-form">
        <div class="din-finance-heading"><h2>Adicionar cartão</h2></div>
        <form class="form" data-card-form>
          <label class="field">Nome do cartão<input name="name" placeholder="Ex.: Cartão principal" maxlength="80" required /></label>
          <label class="field">Limite cadastrado<input name="limit" inputmode="decimal" placeholder="0,00" required /></label>
          <button class="button" type="submit">Salvar cartão</button>
        </form>
      </article>
      <button type="button" class="din-text-action" data-manage-section="accounts">Gerenciar contas e carteiras</button>
    </section>
  \`;
}

export function goalsView() {
  const budgets = (state.categoryBudgets || []).filter((budget) => !budget.scope || budget.scope === state.scope);
  const total = budgets.reduce((sum, item) => sum + finiteAmount(item.amount), 0);
  const spent = budgets.reduce((sum, item) => sum + Math.max(0, Number(item.spent) || 0), 0);
  const categories = (state.categories || []).map((item) => \`<option value="\${escapeHtml(item.id)}">\${escapeHtml(item.name)}</option>\`).join('');
  const businessTarget = state.scope === 'BUSINESS' ? finiteAmount(state.businessSummary?.configuration?.revenueGoal) : 0;
  const businessRevenue = state.scope === 'BUSINESS' ? finiteAmount(state.businessSummary?.statement?.grossRevenue) : 0;
  return \`
    <section class="din-finance-page din-goals-page" aria-label="Metas e limites">
      <p class="din-finance-intro">Organize seus limites mensais por categoria. Os valores vêm dos orçamentos registrados no aplicativo.</p>
      \${state.scope === 'BUSINESS' ? \`<article class="din-finance-goal din-business-target">
        <div class="din-finance-heading"><h2>Meta de faturamento</h2><span>Empresarial</span></div>
        \${businessTarget ? \`<strong class="din-target-number">\${money.format(businessRevenue)}</strong><p>de \${money.format(businessTarget)} definidos</p>
          <div class="din-track" role="progressbar" aria-label="Progresso do faturamento" aria-valuemin="0" aria-valuemax="100" aria-valuenow="\${clampPercent(Math.round((businessRevenue / businessTarget) * 100))}"><span style="width:\${clampPercent(Math.round((businessRevenue / businessTarget) * 100))}%"></span></div>\`
          : '<p>Defina uma meta de faturamento nas configurações do negócio.</p>'}
        <button class="din-text-action" type="button" data-business-onboarding-edit>Editar meta empresarial</button>
      </article>\` : ''}
      <div class="din-finance-overview">
        <div><span>Limites definidos</span><strong>\${money.format(total)}</strong></div>
        <div><span>Utilizados</span><strong>\${money.format(spent)}</strong></div>
      </div>
      <div class="din-finance-heading"><h2>Limites por categoria</h2><span>\${budgets.length} \${budgets.length === 1 ? 'categoria' : 'categorias'}</span></div>
      <div class="din-goal-list">
        \${budgets.length ? budgets.map((budget) => {
          const amount = finiteAmount(budget.amount);
          const used = Math.max(0, Number(budget.spent) || 0);
          const ratio = amount ? clampPercent(Math.round(used / amount * 100)) : 0;
          return \`<article class="din-goal-item"><div class="din-goal-head"><div><h3>\${escapeHtml(budget.categoryName || 'Categoria')}</h3><p>\${money.format(used)} de \${money.format(amount)}</p></div><button type="button" data-budget-delete="\${escapeHtml(budget.id)}" aria-label="Remover limite de \${escapeHtml(budget.categoryName || 'categoria')}">Remover</button></div>
          <div class="din-track" role="progressbar" aria-label="Limite utilizado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="\${ratio}"><span style="width:\${ratio}%"></span></div></article>\`;
        }).join('') : '<p class="din-empty">Nenhum limite por categoria. Crie um abaixo para acompanhar seus gastos.</p>'}
      </div>
      <article class="din-finance-form">
        <div class="din-finance-heading"><h2>Definir limite mensal</h2></div>
        <form class="form" data-budget-form>
          <label class="field">Categoria<select name="categoryId" required><option value="">Escolha uma categoria</option>\${categories}</select></label>
          <label class="field">Valor mensal<input name="budget" inputmode="decimal" placeholder="0,00" required /></label>
          <button type="submit" class="button">Salvar limite</button>
        </form>
      </article>
      <button class="din-text-action" type="button" data-tab-jump="planning">Ver planejamento financeiro</button>
    </section>
  \`;
}

export function planningForecast(scope, transactions, today = new Date(), adjustment = 0) {
  const validAdjustment = [-10, 0, 10, 20].includes(adjustment) ? adjustment : 0;
  const sums = [];
  for (let monthsAgo = 3; monthsAgo >= 1; monthsAgo--) {
    const month = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    const period = monthKey(month);
    const items = transactions.filter((tx) => {
      if (transactionScope(tx) !== scope) return false;
      if (!['INCOME', 'EXPENSE'].includes(tx.type)) return false;
      const date = new Date(tx.date);
      return !Number.isNaN(date.getTime()) && monthKey(date) === period;
    });
    sums.push(items.reduce((acc, tx) => {
      const val = finiteAmount(tx.netAmount ?? tx.amount);
      if (tx.type === 'INCOME') acc.income += val;
      else acc.expense += val;
      return acc;
    }, { income: 0, expense: 0, count: items.length }));
  }
  const sampledMonths = sums.filter((item) => item.count > 0).length;
  if (!sampledMonths) return { sampledMonths: 0, income: 0, expense: 0, adjustment: validAdjustment, monthlyResult: 0, projection: [] };
  const income = sums.reduce((sum, item) => sum + item.income, 0) / sampledMonths;
  const baseExpense = sums.reduce((sum, item) => sum + item.expense, 0) / sampledMonths;
  const expense = baseExpense * (1 + validAdjustment / 100);
  const monthlyResult = income - expense;
  const projection = [1, 2, 3].map((offset) => {
    const date = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return { label: new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(date), result: monthlyResult, cumulative: monthlyResult * offset };
  });
  return { sampledMonths, income, expense, adjustment: validAdjustment, monthlyResult, projection };
}

export function planningView() {
  const adjustment = state.planningExpenseAdjustment || 0;
  const projection = planningForecast(state.scope, scopedTransactions(), new Date(), adjustment);
  const options = [-10, 0, 10, 20].map((n) => \`<button type="button" data-planning-adjustment="\${n}" class="\${projection.adjustment === n ? 'active' : ''}" aria-pressed="\${projection.adjustment === n}">\${n > 0 ? '+' : ''}\${n}%</button>\`).join('');
  return \`
    <section class="din-finance-page din-planning-page" aria-label="Planejamento financeiro">
      <p class="din-finance-intro">Simule os próximos meses a partir da média dos últimos três meses completos com lançamentos. Não é uma previsão garantida nem o saldo da sua conta.</p>
      <div class="din-finance-heading"><h2>Simule suas despesas</h2><span>Em relação à média</span></div>
      <div class="din-planning-options" role="group" aria-label="Ajuste hipotético das despesas">\${options}</div>
      \${projection.sampledMonths ? \`
        <div class="din-finance-overview">
          <div><span>Receita média</span><strong>\${money.format(projection.income)}</strong></div>
          <div><span>Despesa no cenário</span><strong>\${money.format(projection.expense)}</strong></div>
        </div>
        <article class="din-planning-result">
          <span>Resultado mensal simulado</span><strong class="\${projection.monthlyResult < 0 ? 'negative' : ''}">\${money.format(projection.monthlyResult)}</strong>
          <p>Baseado em \${projection.sampledMonths} \${projection.sampledMonths === 1 ? 'mês' : 'meses'} com registros. Meses sem lançamentos não entram na média.</p>
        </article>
        <div class="din-finance-heading"><h2>Próximos 3 meses</h2><span>Resultado acumulado</span></div>
        <div class="din-projection-list">
          \${projection.projection.map((item) => \`<div class="din-projection-row"><span>\${escapeHtml(item.label)}</span><strong class="\${item.cumulative < 0 ? 'negative' : ''}">\${money.format(item.cumulative)}</strong></div>\`).join('')}
        </div>
      \` : '<div class="din-empty">Ainda não há lançamentos em meses completos suficientes para uma simulação. Registre receitas e despesas para começar.</div>'}
      <p class="din-finance-note">Simulação apenas informativa: não considera juros, saldos bancários, contas futuras ou sazonalidade. Ajustes são temporários e não alteram seus lançamentos.</p>
      <button type="button" class="din-text-action" data-tab-jump="transactions">Conferir transações</button>
      <button type="button" class="din-text-action" data-tab-jump="budget">Configurar limites por categoria</button>
    </section>
  \`;
}
