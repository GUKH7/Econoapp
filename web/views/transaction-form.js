import { colors, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTransactions, scopeLabel } from '../finance.js';
import { currentMonth, emptyState, icon, transactionRow } from './shared.js';

export function transactionSheet() {
  const type = state.quickType || 'EXPENSE';
  const isIncome = type === 'INCOME';
  return `
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="${isIncome ? 'Nova receita' : 'Novo gasto'}">
      <div class="sheet-handle"></div>
      <div class="panel-title sheet-title">
        <div>
          <span>${scopeLabel()}</span>
          <h2>${isIncome ? 'Nova receita' : 'Novo gasto'}</h2>
        </div>
        <button class="icon-button" type="button" data-sheet-close aria-label="Fechar">x</button>
      </div>
      ${transactionFormHtml(type, 'sheet')}
    </section>
  `;
}

export function launchView() {
  const type = state.quickType || 'EXPENSE';
  const isIncome = type === 'INCOME';
  return `
    <h2 class="section-title">${isIncome ? 'Nova receita' : 'Novo gasto'}</h2>
    <div class="split">
      <article class="card">
        ${transactionFormHtml(type, 'page')}
      </article>
      <article class="card">
        <div class="panel-title"><h2>Registros ${scopeLabel()}</h2></div>
        ${scopedTransactions().slice(0, 12).map(transactionRow).join('') || '<p class="empty">Nenhum registro ainda.</p>'}
      </article>
    </div>
  `;
}

function transactionFormHtml(type, context) {
  const isExpense = type === 'EXPENSE';
  const categoryLabel = isExpense ? 'Categoria do gasto' : 'Origem da receita';
  const createCategoryLabel = isExpense ? 'Criar nova categoria de gasto' : 'Criar nova origem de receita';
  const paymentLabel = isExpense ? 'Forma de pagamento' : 'Receber em';
  const quickAmounts = isExpense ? ['25,00', '50,00', '100,00'] : ['250,00', '1.000,00', '2.500,00'];
  const availableCategories = state.categories.filter((category) => {
    const kind = state.categoryKinds[category.id];
    if (isExpense) return !kind || kind === 'EXPENSE';
    return kind === 'INCOME';
  });
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);
  const walletOptions = scopedWallets
    .map(
      (wallet) =>
        `<option value="${wallet.id}">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} - ${escapeHtml(wallet.name)}</option>`,
    )
    .join('');
  const expensePaymentOptions = [
    ...scopedWallets.map(
      (wallet) =>
        `<option value="account:${wallet.id}">${wallet.type === 'BANK' ? 'Banco' : 'Carteira'} - ${escapeHtml(wallet.name)}</option>`,
    ),
    ...scopedCards.map((card) => `<option value="card:${card.id}">Cartão - ${escapeHtml(card.name)}</option>`),
  ].join('');

  return `
    <form class="form transaction-form" data-transaction-form data-context="${context}">
      <div class="entry-hero ${isExpense ? 'expense-mode' : 'income-mode'}">
        <div class="entry-mode-row">
          <span class="entry-mode-icon ${isExpense ? 'expense-bg' : 'income-bg'}">${isExpense ? icon('minus') : icon('plus')}</span>
          <span><strong>${isExpense ? 'Saída de dinheiro' : 'Entrada de dinheiro'}</strong><small>${scopeLabel()} - ${currentMonth}</small></span>
        </div>
        <div class="type-toggle" aria-label="Tipo do lançamento">
          <label class="${isExpense ? 'active' : ''}">
            <input type="radio" name="type" value="EXPENSE" data-transaction-type ${isExpense ? 'checked' : ''} />
            <span>Gasto</span>
          </label>
          <label class="${isExpense ? '' : 'active'}">
            <input type="radio" name="type" value="INCOME" data-transaction-type ${isExpense ? '' : 'checked'} />
            <span>Receita</span>
          </label>
        </div>
        <label class="amount-field">
          <span>Valor</span>
          <input class="amount-input" name="amount" inputmode="numeric" required placeholder="R$ 0,00" />
        </label>
        <div class="amount-presets" aria-label="Valores rapidos">
          ${quickAmounts.map((amount) => `<button type="button" data-amount-preset="${amount}">R$ ${amount}</button>`).join('')}
        </div>
      </div>
      <div class="form-section">
        <label class="field form-row">
          <span class="row-icon neutral-bg">${icon('chat')}</span>
          <span>Descrição</span>
          <input name="description" required placeholder="Ex: Mercado, venda Shopee, frete" />
        </label>
        <label class="field select-row form-row">
          <span class="row-icon neutral-bg">${icon('tag')}</span>
          <span>${categoryLabel}</span>
          <select name="categoryId" ${availableCategories.length ? 'required' : ''}>
            ${availableCategories.length ? availableCategories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('') : '<option value="">Crie uma nova abaixo</option>'}
          </select>
        </label>
        <details class="inline-create" ${availableCategories.length ? '' : 'open'}>
          <summary>${createCategoryLabel}</summary>
          <label class="field">Nome<input name="newCategoryName" placeholder="${isExpense ? 'Ex: Alimentação, Frete, Taxas' : 'Ex: Salário, Vendas, Rendimentos'}" /></label>
          <div class="field">
            <label>Cor</label>
            <div class="swatches">${colors.map((color) => `<button class="swatch ${state.categoryColor === color ? 'active' : ''}" type="button" style="background:${color}" data-color="${color}"></button>`).join('')}</div>
          </div>
        </details>
      </div>
      <div class="form-section">
        <label class="field select-row form-row ${isExpense ? '' : 'hidden'}">
          <span class="row-icon neutral-bg">${icon('wallet')}</span>
          <span>${paymentLabel}</span>
          <select name="paymentMethod" ${isExpense ? 'required' : ''}>
            ${expensePaymentOptions || '<option value="">Cadastre uma carteira, banco ou cartão</option>'}
          </select>
        </label>
        <label class="field select-row form-row ${isExpense ? 'hidden' : ''}">
          <span class="row-icon neutral-bg">${icon('wallet')}</span>
          <span>${paymentLabel}</span>
          <select name="receiveAccount" ${isExpense ? '' : 'required'}>
            ${walletOptions || '<option value="">Cadastre um banco ou carteira</option>'}
          </select>
        </label>
        <label class="field select-row form-row ${state.scope === 'BUSINESS' ? '' : 'hidden'}">
          <span class="row-icon neutral-bg">${icon('shop')}</span>
          <span>Canal ou meio</span>
          <select name="channelId">
            <option value="">Sem canal</option>
            ${state.channels.map((channel) => `<option value="${channel.id}">${escapeHtml(channel.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="sheet-actions">
        <button class="button" type="submit">Salvar lançamento</button>
      </div>
    </form>
  `;
}
