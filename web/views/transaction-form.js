import { colors, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopedTransactions, scopeLabel } from '../finance.js';
import { currentMonth, icon, transactionRow } from './shared.js';

export function transactionSheet() {
  const type = state.quickType || 'EXPENSE';
  const title = transactionTitle(type);
  return `
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-handle"></div>
      <div class="panel-title sheet-title">
        <div>
          <span>${scopeLabel()}</span>
          <h2>${title}</h2>
        </div>
        <button class="icon-button" type="button" data-sheet-close aria-label="Fechar">x</button>
      </div>
      ${transactionFormHtml(type, 'sheet')}
    </section>
  `;
}

export function transactionSuccessSheet() {
  const success = state.transactionSuccess;
  if (!success) return '';
  const isExpense = success.type === 'EXPENSE';
  const title = isExpense ? 'Gasto registrado' : 'Receita registrada';
  const amountClass = isExpense ? 'expense' : 'income';
  const dateLabel = formatSuccessDate(success.date);

  return `
    <div class="sheet-backdrop success-backdrop" data-success-close></div>
    <section class="success-sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="success-icon ${isExpense ? 'expense-bg' : 'income-bg'}">${entryIcon(success.type)}</div>
      <span class="eyebrow">${scopeLabel()}</span>
      <h2>${title}</h2>
      <p>Seu saldo e relatórios foram atualizados com esse lançamento.</p>

      <div class="success-summary">
        <div>
          <small>Valor</small>
          <strong class="${amountClass}">${money.format(success.amount || 0)}</strong>
        </div>
        <div>
          <small>${isExpense ? 'Categoria' : 'Origem'}</small>
          <strong>${escapeHtml(success.categoryName || 'Não informado')}</strong>
        </div>
        <div>
          <small>${isExpense ? 'Pagamento' : 'Recebido em'}</small>
          <strong>${escapeHtml(success.paymentLabel || 'Não informado')}</strong>
        </div>
        <div>
          <small>Data</small>
          <strong>${escapeHtml(dateLabel)}</strong>
        </div>
      </div>

      <div class="success-description">
        <span>${entryIcon(success.type)}</span>
        <strong>${escapeHtml(success.description || title)}</strong>
      </div>

      <div class="success-actions">
        <button class="button secondary" type="button" data-success-flow>Ver fluxo</button>
        <button class="button" type="button" data-success-new>Novo lançamento</button>
      </div>
    </section>
  `;
}

export function launchView() {
  const type = state.quickType || 'EXPENSE';
  return `
    <h2 class="section-title">${transactionTitle(type)}</h2>
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
  const isIncome = type === 'INCOME';
  const isTransfer = type === 'TRANSFER';
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
  const today = todayInputValue();

  return `
    <form class="form transaction-form" data-transaction-form data-context="${context}">
      <div class="entry-hero ${entryHeroClass(type)}">
        <div class="entry-mode-row">
          <span class="entry-mode-icon ${entryIconClass(type)}">${entryIcon(type)}</span>
          <span><strong>${entryHeadline(type)}</strong><small>${scopeLabel()} - ${currentMonth}</small></span>
        </div>
        <div class="entry-steps" aria-label="Etapas do lançamento">
          <span class="active">Tipo</span>
          <span>Valor</span>
          <span>Detalhes</span>
        </div>
        <div class="type-toggle three-options" aria-label="Tipo do lançamento">
          ${typeOption('EXPENSE', 'Gasto', type)}
          ${typeOption('INCOME', 'Receita', type)}
          ${typeOption('TRANSFER', 'Transferência', type)}
        </div>
        <label class="amount-field">
          <span>Valor</span>
          <input class="amount-input" name="amount" inputmode="numeric" required placeholder="R$ 0,00" ${isTransfer ? 'disabled' : ''} />
        </label>
        <div class="amount-presets" aria-label="Valores rápidos">
          ${quickAmounts.map((amount) => `<button type="button" data-amount-preset="${amount}" ${isTransfer ? 'disabled' : ''}>R$ ${amount}</button>`).join('')}
        </div>
      </div>

      ${
        isTransfer
          ? transferPreviewHtml(walletOptions)
          : `
              <article class="din-entry-helper">
                <span class="assistant-avatar">${icon('chat')}</span>
                <div>
                  <strong>Prefere conversar?</strong>
                  <p>${isExpense ? 'Conte o gasto em uma frase e o Din ajuda a completar.' : 'Conte a entrada em uma frase e o Din ajuda a registrar.'}</p>
                </div>
                <button type="button" data-din-compose="${isExpense ? 'Gastei R$ 40 no mercado hoje' : 'Recebi R$ 250 de uma venda hoje'}">Usar Din</button>
              </article>

              <div class="form-section transaction-details-section">
                <label class="field form-row">
                  <span class="row-icon neutral-bg">${icon('chat')}</span>
                  <span>Descrição</span>
                  <input name="description" required placeholder="${isExpense ? 'Ex: Mercado, restaurante, frete' : 'Ex: Salário, venda, serviço'}" />
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
                <label class="field select-row form-row ${isIncome ? '' : 'hidden'}">
                  <span class="row-icon neutral-bg">${icon('wallet')}</span>
                  <span>${paymentLabel}</span>
                  <select name="receiveAccount" ${isIncome ? 'required' : ''}>
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
                <label class="field form-row">
                  <span class="row-icon neutral-bg">${icon('calendar')}</span>
                  <span>Data</span>
                  <input name="date" type="date" value="${today}" max="2099-12-31" />
                </label>
              </div>

              <div class="transaction-confirmation ${isExpense ? 'expense' : 'income'}">
                <span>${entryIcon(type)}</span>
                <div>
                  <strong>${isExpense ? 'Pronto para registrar uma saída' : 'Pronto para registrar uma entrada'}</strong>
                  <small>${isExpense ? 'Valor, pagamento, categoria e data atualizam seu saldo e relatórios.' : 'Valor, origem, conta e data atualizam seu saldo e relatórios.'}</small>
                </div>
              </div>
            `
      }

      <div class="sheet-actions">
        <button class="button ${isExpense ? 'danger' : ''}" type="submit" ${isTransfer ? 'disabled' : ''}>
          ${isTransfer ? 'Transferência em breve' : 'Salvar lançamento'}
        </button>
      </div>
    </form>
  `;
}

function typeOption(value, label, currentType) {
  const isActive = currentType === value;
  return `
    <label class="${isActive ? 'active' : ''}">
      <input type="radio" name="type" value="${value}" data-transaction-type ${isActive ? 'checked' : ''} />
      <span>${label}</span>
    </label>
  `;
}

function transferPreviewHtml(walletOptions) {
  return `
    <div class="form-section transfer-preview">
      <div class="form-row">
        <span class="row-icon neutral-bg">${icon('wallet')}</span>
        <span>Conta de origem</span>
        <select disabled>
          ${walletOptions || '<option>Cadastre uma conta ou carteira</option>'}
        </select>
      </div>
      <div class="form-row">
        <span class="row-icon neutral-bg">${icon('flow')}</span>
        <span>Conta de destino</span>
        <select disabled>
          ${walletOptions || '<option>Cadastre uma conta ou carteira</option>'}
        </select>
      </div>
      <div class="transaction-confirmation neutral">
        <span>${icon('flow')}</span>
        <div>
          <strong>Transferência preparada para a próxima etapa</strong>
          <small>O visual já está no padrão do app. Para salvar transferências reais, vamos adicionar suporte no backend e ajuste automático entre contas.</small>
        </div>
      </div>
    </div>
  `;
}

function transactionTitle(type) {
  if (type === 'INCOME') return 'Nova receita';
  if (type === 'TRANSFER') return 'Nova transferência';
  return 'Novo gasto';
}

function entryHeadline(type) {
  if (type === 'INCOME') return 'Entrada de dinheiro';
  if (type === 'TRANSFER') return 'Mover dinheiro entre contas';
  return 'Saída de dinheiro';
}

function entryHeroClass(type) {
  if (type === 'INCOME') return 'income-mode';
  if (type === 'TRANSFER') return 'transfer-mode';
  return 'expense-mode';
}

function entryIconClass(type) {
  if (type === 'INCOME') return 'income-bg';
  if (type === 'TRANSFER') return 'neutral-bg';
  return 'expense-bg';
}

function entryIcon(type) {
  if (type === 'INCOME') return icon('plus');
  if (type === 'TRANSFER') return icon('flow');
  return icon('minus');
}

function todayInputValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatSuccessDate(value) {
  if (!value) return currentMonth;
  const [datePart] = String(value).split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  if (!year || !month || !day) return currentMonth;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(
    new Date(year, month - 1, day),
  );
}
