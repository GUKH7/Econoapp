import { colors, money, state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { scopeLabel } from '../finance.js';
import { currentMonth, emptyState, icon, nextMonth, previousMonth } from './shared.js';
import { transactionToolsView } from './transactions.js';

export function budgetView() {
  const key = state.scope;
  const currentBudget = Number(state.budgets[key] || 0);
  const spent = Number(state.budgetSummary?.totalSpent || 0);
  const used = currentBudget > 0 ? Math.min(100, (spent / currentBudget) * 100) : 0;
  const categoryOptions = state.categories
    .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
    .join('');
  const budgetRows = state.categoryBudgets
    .map(
      (budget) => `
        <div class="row">
          <span class="category-dot" style="background:${escapeHtml(budget.categoryColor || '#22C55E')}"></span>
          <div class="row-main">
            <div class="row-title">${escapeHtml(budget.categoryName)}</div>
            <div class="row-meta">${money.format(Number(budget.spent || 0))} de ${money.format(Number(budget.amount || 0))} - ${Number(budget.percentage || 0)}%</div>
            <div class="budget-progress"><span style="width:${Math.min(100, Number(budget.percentage || 0))}%"></span></div>
          </div>
          <button class="button secondary compact-action" type="button" data-budget-delete="${budget.id}">Remover</button>
        </div>
      `,
    )
    .join('');
  return `
    <div class="period-switch">
      <button type="button">${previousMonth}</button>
      <button class="active" type="button">${currentMonth}</button>
      <button type="button">${nextMonth}</button>
    </div>
    <article class="card">
      ${
        currentBudget
          ? `<div class="panel-title"><h2>Limite ${scopeLabel()}</h2><strong>${money.format(currentBudget)}</strong></div>
             <div class="budget-progress"><span style="width:${used}%"></span></div>
             <p class="muted">${money.format(spent)} usados de ${money.format(currentBudget)}</p>
             <div class="menu-list budget-list">${budgetRows}</div>`
          : emptyState(
              'Nenhum limite definido',
              'Defina um teto mensal para acompanhar seus gastos antes do fim do mês.',
              icon('target'),
            )
      }
      <form class="form" data-budget-form style="margin-top:18px">
        <label class="field">Categoria
          <select name="categoryId" required>
            <option value="">Selecione uma categoria</option>
            ${categoryOptions}
          </select>
        </label>
        <label class="field">Limite mensal<input name="budget" inputmode="decimal" placeholder="0,00" required /></label>
        <button class="button" type="submit">Definir limite</button>
      </form>
    </article>
  `;
}

export function moreView() {
  if (state.manageSection) return manageView();

  return `
    <section class="more-shell">
      <article class="profile-card">
        <div class="profile-avatar">${escapeHtml((state.user?.name || 'U').slice(0, 1).toUpperCase())}</div>
        <div>
          <h2>${escapeHtml(state.user?.name || 'Usuário')}</h2>
          <p>${escapeHtml(state.user?.email || state.user?.phone || '')}</p>
        </div>
      </article>
      <article class="card">
        <div class="panel-title"><h2>Gerenciar</h2></div>
        <div class="menu-list">
          <button class="menu-item" type="button" data-tab-jump="launch"><span class="tab-icon">+/-</span><span>Lançamentos</span><span>›</span></button>
          <button class="menu-item" type="button" data-manage-section="accounts"><span class="tab-icon">${icon('wallet')}</span><span>Contas e cartões</span><span>›</span></button>
          <button class="menu-item" type="button" data-manage-section="business"><span class="tab-icon">${icon('shop')}</span><span>Contas a pagar e receber</span><span>›</span></button>
          <button class="menu-item" type="button" data-manage-section="categories"><span class="tab-icon">${icon('tag')}</span><span>Categorias e canais</span><span>›</span></button>
          <button class="menu-item" type="button" data-tab-jump="budget"><span class="tab-icon">${icon('target')}</span><span>Limites e metas</span><span>›</span></button>
          <button class="menu-item" type="button" data-tab-jump="assistant"><span class="tab-icon">${icon('chat')}</span><span>Din / Assistente</span><span>›</span></button>
          ${
            state.user?.isWhatsappAdmin
              ? `<button class="menu-item" type="button" data-manage-section="whatsapp"><span class="tab-icon">${icon('chat')}</span><span>WhatsApp</span><span>›</span></button>`
              : ''
          }
        </div>
      </article>
      <article class="card">
        <div class="panel-title"><div><span class="eyebrow">Ferramentas</span><h2>Automação e dados</h2></div></div>
        ${transactionToolsView()}
      </article>
      <article class="card privacy-card">
        <div class="panel-title"><div><span class="eyebrow">Privacidade</span><h2>Seus dados e sua conta</h2></div></div>
        <p class="muted">Baixe uma cópia das informações armazenadas ou exclua permanentemente sua conta.</p>
        <div class="privacy-actions">
          <button class="button secondary" type="button" data-export-account>Baixar meus dados</button>
          <button class="button danger" type="button" data-delete-account>Excluir minha conta</button>
        </div>
      </article>
      <button class="button danger" type="button" data-logout>Sair da conta</button>
    </section>
  `;
}

export function manageView() {
  const scopedWallets = state.wallets.filter((wallet) => !wallet.scope || wallet.scope === state.scope);
  const scopedCards = state.cards.filter((card) => !card.scope || card.scope === state.scope);
  const section = state.manageSection || 'accounts';
  const activeAccountTab = state.manageAccountTab || 'accounts';
  const bankAccounts = scopedWallets.filter((wallet) => wallet.type === 'BANK');
  const cashWallets = scopedWallets.filter((wallet) => wallet.type !== 'BANK');
  const totalBalance = scopedWallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  const sections = [
    { id: 'business', label: 'Agenda', meta: `${state.businessEntries.length} contas`, icon: icon('shop') },
    { id: 'contacts', label: 'Clientes', meta: `${state.businessContacts.length} contatos`, icon: icon('profile') },
    { id: 'offerings', label: 'Produtos', meta: `${state.businessOfferings.filter((item) => item.isActive !== false).length} itens`, icon: icon('tag') },
    { id: 'accounts', label: 'Contas', meta: `${scopedWallets.length + scopedCards.length} itens`, icon: icon('wallet') },
    { id: 'categories', label: 'Categorias', meta: `${state.categories.length} itens`, icon: icon('tag') },
    { id: 'channels', label: 'Canais', meta: `${state.channels.length} meios`, icon: icon('shop') },
    ...(state.user?.isWhatsappAdmin
      ? [{ id: 'whatsapp', label: 'WhatsApp', meta: whatsappStatusLabel(), icon: icon('chat') }]
      : []),
  ];
  const nav = sections
    .map(
      (item) => `
        <button class="manage-pill ${section === item.id ? 'active' : ''}" type="button" data-manage-section="${item.id}">
          <span class="tab-icon">${item.icon}</span>
          <span><strong>${item.label}</strong><small>${item.meta}</small></span>
        </button>
      `,
    )
    .join('');

  const accountRows = {
    accounts: bankAccounts,
    wallets: cashWallets,
  };
  const selectedWallets = accountRows[activeAccountTab] || bankAccounts;
  const accountEmpty = activeAccountTab === 'wallets' ? 'Cadastre uma carteira para dinheiro físico ou caixa.' : 'Cadastre seus bancos e contas correntes.';
  const accountAddLabel = activeAccountTab === 'cards' ? 'Adicionar cartão' : activeAccountTab === 'wallets' ? 'Adicionar carteira' : 'Adicionar conta';
  const accountModalType = activeAccountTab === 'cards' ? 'card' : activeAccountTab === 'wallets' ? 'wallet' : 'account';

  const accountsPanel = `
    <article class="card manage-panel">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Saldo total</span>
          <h2>${money.format(totalBalance)}</h2>
        </div>
        <button class="icon-button" type="button" data-manage-modal="${accountModalType}" aria-label="${accountAddLabel}">+</button>
      </div>
      <div class="account-tabs" role="tablist" aria-label="Contas e cartões">
        ${accountTab('accounts', 'Contas', activeAccountTab)}
        ${accountTab('cards', 'Cartões', activeAccountTab)}
        ${accountTab('wallets', 'Carteiras', activeAccountTab)}
      </div>
      <div class="surface-list">
        ${
          activeAccountTab === 'cards'
            ? accountCardRows(scopedCards)
            : selectedWallets.map(walletRow).join('') || `<p class="empty">${accountEmpty}</p>`
        }
      </div>
    </article>
  `;

  const categoriesPanel = `
    <article class="card manage-panel">
      <div class="panel-title"><h2>Categorias</h2></div>
      <form class="form" data-category-form>
        <label class="field">Nome<input name="name" required placeholder="Ex: Alimentação, Moradia, Taxas" /></label>
        <label class="field">Uso
          <select name="kind">
            <option value="EXPENSE">Gasto</option>
            <option value="INCOME">Receita</option>
          </select>
        </label>
        <div class="field">
          <label>Cor</label>
          <div class="swatches">${colors.map((color) => `<button class="swatch ${state.categoryColor === color ? 'active' : ''}" type="button" style="background:${color}" data-color="${color}"></button>`).join('')}</div>
        </div>
        <button class="button" type="submit">Criar categoria</button>
      </form>
      <div class="chip-list surface-list">
        ${state.categories.map((category) => `<span class="chip"><span class="dot" style="background:${category.color}"></span>${escapeHtml(category.name)}${state.categoryKinds[category.id] === 'INCOME' ? ' - receita' : state.categoryKinds[category.id] === 'EXPENSE' ? ' - gasto' : ''}</span>`).join('')}
      </div>
    </article>
  `;

  const channelsPanel = `
    <article class="card manage-panel">
      <div class="panel-title"><h2>Canais de venda e meios</h2></div>
      <form class="form" data-channel-form>
        <label class="field">Nome<input name="name" required placeholder="Ex: Shopee, Mercado Livre, Pix Loja" /></label>
        <label class="field">Taxa (%)<input name="feePercent" inputmode="decimal" value="0" /></label>
        <button class="button" type="submit">Criar canal</button>
      </form>
      <div class="surface-list">
        ${state.channels.map((channel) => `<div class="row"><div><div class="row-title">${escapeHtml(channel.name)}</div><div class="row-meta">Taxa ${Number(channel.feePercent).toFixed(2)}%</div></div></div>`).join('') || '<p class="empty">Cadastre canais para separar vendas do negócio.</p>'}
      </div>
    </article>
  `;

  const businessCategories = state.categories
    .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
    .join('');
  const businessAccounts = state.wallets
    .filter((account) => account.scope === 'BUSINESS')
    .map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`)
    .join('');
  const businessContactOptions = state.businessContacts
    .map((contact) => `<option value="${contact.id}" data-contact-name="${escapeHtml(contact.name)}">${escapeHtml(contact.name)} · ${contact.type === 'CLIENT' ? 'Cliente' : contact.type === 'SUPPLIER' ? 'Fornecedor' : 'Cliente e fornecedor'}</option>`)
    .join('');
  const businessOfferingOptions = state.businessOfferings
    .filter((offering) => offering.isActive !== false)
    .map((offering) => `<option value="${offering.id}">${escapeHtml(offering.name)}</option>`)
    .join('');
  const contactsPanel = `
    <article class="card manage-panel business-contacts-panel">
      <div class="panel-title"><div><span class="eyebrow">Relacionamentos</span><h2>Clientes e fornecedores</h2></div></div>
      <p class="muted">Um cadastro curto para acompanhar vendas, compras e valores pendentes.</p>
      <form class="form business-contact-form" data-business-contact-form>
        <div class="form-grid two-columns">
          <label class="field">Nome<input name="name" required minlength="2" placeholder="Ex: João ou Fornecedor Central" /></label>
          <label class="field">Tipo<select name="type" required><option value="CLIENT">Cliente</option><option value="SUPPLIER">Fornecedor</option><option value="BOTH">Cliente e fornecedor</option></select></label>
        </div>
        <div class="form-grid two-columns">
          <label class="field">Telefone<input name="phone" inputmode="tel" placeholder="(11) 99999-9999" /></label>
          <label class="field">E-mail<input name="email" type="email" placeholder="contato@empresa.com" /></label>
        </div>
        <label class="field">Observações<textarea name="notes" rows="2" maxlength="500" placeholder="Preferências, condições ou lembretes"></textarea></label>
        <button class="button" type="submit">Adicionar contato</button>
      </form>
      <div class="business-contact-list surface-list">
        ${state.businessContacts.length ? state.businessContacts.map(businessContactCard).join('') : '<p class="empty">Nenhum cliente ou fornecedor cadastrado.</p>'}
      </div>
    </article>`;
  const productReport = state.productReport || { totals: {}, items: [] };
  const offeringsPanel = `
    <article class="card manage-panel business-offerings-panel">
      <div class="panel-title"><div><span class="eyebrow">Rentabilidade</span><h2>Produtos e serviços</h2></div></div>
      <p class="muted">Cadastre o custo estimado e vincule o item às vendas para acompanhar margem real.</p>
      <form class="form" data-business-offering-form>
        <div class="form-grid two-columns"><label class="field">Nome<input name="name" required placeholder="Ex: Camiseta ou Consultoria" /></label><label class="field">Tipo<select name="type"><option value="PRODUCT">Produto</option><option value="SERVICE">Serviço</option></select></label></div>
        <div class="form-grid two-columns"><label class="field">Custo estimado<input name="estimatedUnitCost" inputmode="decimal" value="0,00" required /></label><label class="field">Preço padrão<input name="defaultPrice" inputmode="decimal" placeholder="Opcional" /></label></div>
        <button class="button" type="submit">Adicionar ao catálogo</button>
      </form>
      <section class="product-report-summary">
        <div><span>Receita líquida</span><strong>${money.format(Number(productReport.totals?.netRevenue || 0))}</strong></div><div><span>Custo estimado</span><strong>${money.format(Number(productReport.totals?.estimatedCost || 0))}</strong></div><div><span>Margem</span><strong>${money.format(Number(productReport.totals?.margin || 0))}</strong></div><div><span>Quantidade</span><strong>${Number(productReport.totals?.quantity || 0).toLocaleString('pt-BR')}</strong></div>
      </section>
      ${productReport.mostProfitable ? `<div class="product-insight positive"><span>Mais lucrativo</span><strong>${escapeHtml(productReport.mostProfitable.name)}</strong><small>${money.format(Number(productReport.mostProfitable.margin))} de margem</small></div>` : ''}
      ${productReport.highVolumeLowMargin ? `<div class="product-insight warning"><span>Vende bem, margem baixa</span><strong>${escapeHtml(productReport.highVolumeLowMargin.name)}</strong><small>${Number(productReport.highVolumeLowMargin.marginPercent).toFixed(1)}% de margem</small></div>` : ''}
      <div class="product-performance-list">${productReport.items?.length ? productReport.items.map(productPerformanceRow).join('') : '<p class="empty">Vincule produtos às vendas para gerar o relatório.</p>'}</div>
      <div class="business-catalog-list surface-list">${state.businessOfferings.length ? state.businessOfferings.map(businessOfferingRow).join('') : '<p class="empty">Nenhum produto ou serviço cadastrado.</p>'}</div>
    </article>`;
  const businessRows = state.businessEntries.map((entry) => businessEntryRow(entry)).join('');
  const businessSummary = state.businessSummary || {};
  const businessSettings = state.businessSettings || businessSummary.configuration || {};
  const costCategories = businessSummary.expenseCategories || [];
  const businessResultConfig = `
    <section class="business-result-config">
      ${businessSettings.onboardingCompleted ? `<div class="business-profile-summary"><div><span class="eyebrow">Perfil empresarial</span><strong>${escapeHtml(businessTypeLabel(businessSettings.businessType))}</strong><small>Meta ${money.format(Number(businessSettings.revenueGoal || 0))} · ${(businessSettings.receivingMethods || []).map(escapeHtml).join(', ')}</small></div><button class="button secondary compact-action" type="button" data-business-onboarding-edit>Editar perfil</button></div>` : ''}
      <div class="panel-title"><div><span class="eyebrow">Resultado empresarial</span><h2>Impostos e tipos de gasto</h2></div></div>
      <p class="muted">Essas informações permitem separar resultado do mês de lucro líquido estimado.</p>
      <form class="form" data-business-tax-form>
        <label class="field">Alíquota estimada de impostos (%)<input name="taxRate" inputmode="decimal" value="${Number(businessSummary.configuration?.taxRate || 0).toLocaleString('pt-BR')}" required /></label>
        <button class="button secondary" type="submit">Salvar alíquota</button>
      </form>
      <div class="business-cost-categories">
        ${costCategories.length ? costCategories.map((category) => `<label class="field business-cost-row"><span><strong>${escapeHtml(category.name)}</strong><small>${money.format(Number(category.total || 0))} no mês</small></span><select data-business-cost-category="${category.id}"><option value="" ${!category.businessCostType ? 'selected' : ''}>Não classificado</option><option value="VARIABLE" ${category.businessCostType === 'VARIABLE' ? 'selected' : ''}>Custo variável</option><option value="FIXED" ${category.businessCostType === 'FIXED' ? 'selected' : ''}>Despesa fixa</option></select></label>`).join('') : '<p class="empty">As categorias usadas em gastos empresariais aparecerão aqui.</p>'}
      </div>
    </section>`;
  const businessPanel = `
    <article class="card manage-panel business-agenda-panel">
      ${businessResultConfig}
      <div class="business-config-divider"></div>
      <div class="panel-title"><div><span class="eyebrow">Planejamento</span><h2>Contas a pagar e receber</h2></div></div>
      <form class="form business-entry-form" data-business-entry-form>
        <div class="form-grid two-columns">
          <label class="field">Tipo<select name="type" required><option value="RECEIVABLE">Conta a receber</option><option value="PAYABLE">Conta a pagar</option></select></label>
          <label class="field">Vencimento<input name="dueDate" type="date" required /></label>
        </div>
        <label class="field">Descrição<input name="title" required placeholder="Ex: Mensalidade, aluguel, fornecedor" /></label>
        <label class="field">Usar cadastro<select name="contactId" data-business-contact-select><option value="">Selecionar cliente ou fornecedor</option>${businessContactOptions}</select></label>
        <div class="form-grid two-columns"><label class="field">Produto ou serviço<select name="offeringId"><option value="">Sem item vinculado</option>${businessOfferingOptions}</select></label><label class="field">Quantidade<input name="quantity" inputmode="decimal" value="1" /></label></div>
        <label class="field">Cliente ou fornecedor<input name="counterparty" required placeholder="Nome da pessoa ou empresa" /></label>
        <div class="form-grid two-columns">
          <label class="field">Valor<input name="amount" inputmode="decimal" placeholder="0,00" required /></label>
          <label class="field">Categoria<select name="categoryId" required><option value="">Selecione</option>${businessCategories}</select></label>
        </div>
        <label class="field">Conta para liquidação<select name="accountId"><option value="">Definir depois</option>${businessAccounts}</select></label>
        <div class="form-grid two-columns">
          <label class="field">Recorrência<select name="recurrenceFrequency"><option value="">Não repetir</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensal</option><option value="YEARLY">Anual</option></select></label>
          <label class="field">Repetir até<input name="recurrenceEndDate" type="date" /></label>
        </div>
        <button class="button" type="submit">Adicionar à agenda</button>
      </form>
      <div class="business-entry-list surface-list">${businessRows || '<p class="empty">Nenhuma conta planejada. Cadastre o primeiro recebimento ou pagamento.</p>'}</div>
    </article>
  `;

  const whatsapp = state.whatsappStatus;
  const qrCode = whatsapp?.status === 'aguardando_qr' && whatsapp.qrcode ? whatsapp.qrcode : '';
  const whatsappPanel = `
    <article class="card manage-panel">
      <div class="panel-title">
        <h2>WhatsApp</h2>
        <span class="status-badge ${whatsapp?.status === 'conectado' ? 'connected' : ''}">${escapeHtml(whatsappStatusLabel())}</span>
      </div>
      <div class="whatsapp-status">
        ${
          qrCode
            ? `<img class="whatsapp-qr" src="${escapeHtml(qrCode)}" alt="QR Code para conectar o WhatsApp" />`
            : `<div class="whatsapp-placeholder">${state.whatsappLoading ? 'Carregando...' : whatsapp?.status === 'conectado' ? 'Conectado' : 'Sem QR Code disponível'}</div>`
        }
        <p class="row-meta">${state.whatsappError ? escapeHtml(state.whatsappError) : whatsappHelpText()}</p>
      </div>
      <div class="actions-row">
        <button class="button secondary" type="button" data-whatsapp-refresh>${state.whatsappLoading ? 'Atualizando...' : 'Atualizar status'}</button>
        <button class="button" type="button" data-whatsapp-restart>Reiniciar conexão</button>
      </div>
      <form class="form" data-whatsapp-message-form style="margin-top:16px">
        <label class="field">Telefone com DDI<input name="phone" inputmode="tel" placeholder="5511999999999" required /></label>
        <label class="field">Mensagem<textarea name="message" rows="3" placeholder="Mensagem de teste" required></textarea></label>
        <button class="button" type="submit" ${whatsapp?.status === 'conectado' ? '' : 'disabled'}>Enviar mensagem</button>
      </form>
    </article>
  `;

  const panels = {
    business: businessPanel,
    contacts: contactsPanel,
    offerings: offeringsPanel,
    accounts: accountsPanel,
    cards: accountsPanel,
    categories: categoriesPanel,
    channels: channelsPanel,
    whatsapp: whatsappPanel,
  };

  return `
    <section class="manage-shell">
      <button class="back-link" type="button" data-manage-back>‹ Voltar</button>
      <div class="manage-grid">${nav}</div>
      ${state.user?.isWhatsappAdmin || section !== 'whatsapp' ? panels[section] || accountsPanel : accountsPanel}
      ${manageModalHtml()}
    </section>
  `;
}

function productPerformanceRow(item) {
  return `<div class="product-performance-row"><div><strong>${escapeHtml(item.name)}</strong><small>${Number(item.quantity).toLocaleString('pt-BR')} vendidos · ${money.format(Number(item.netRevenue))} de receita</small></div><div><strong>${money.format(Number(item.margin))}</strong><small>${Number(item.marginPercent).toFixed(1)}% margem</small></div></div>`;
}

function businessTypeLabel(value) {
  return ({ COMMERCE: 'Comércio', SERVICES: 'Serviços', FOOD: 'Alimentação', BEAUTY: 'Beleza e bem-estar', FREELANCER: 'Profissional autônomo', OTHER: 'Outro negócio' })[value] || 'Negócio';
}

function businessOfferingRow(offering) {
  return `<div class="row business-offering-row"><div class="row-main"><div class="row-title">${escapeHtml(offering.name)}</div><div class="row-meta">${offering.type === 'PRODUCT' ? 'Produto' : 'Serviço'} · custo ${money.format(Number(offering.estimatedUnitCost || 0))}${offering.defaultPrice ? ` · preço ${money.format(Number(offering.defaultPrice))}` : ''}</div></div>${offering.isActive !== false ? `<button class="danger-link" type="button" data-business-offering-delete="${offering.id}" data-offering-name="${escapeHtml(offering.name)}">Desativar</button>` : '<span class="badge muted">Inativo</span>'}</div>`;
}

function businessContactCard(contact) {
  const typeLabel = contact.type === 'CLIENT' ? 'Cliente' : contact.type === 'SUPPLIER' ? 'Fornecedor' : 'Cliente e fornecedor';
  const movedMetric = contact.type === 'BOTH'
    ? `<span>Total vendido<strong>${money.format(Number(contact.totalSold || 0))}</strong></span><span>Total comprado<strong>${money.format(Number(contact.totalPurchased || 0))}</strong></span>`
    : `<span>${contact.type === 'SUPPLIER' ? 'Total comprado' : 'Total vendido'}<strong>${money.format(Number((contact.type === 'SUPPLIER' ? contact.totalPurchased : contact.totalSold) || 0))}</strong></span>`;
  const lastMovement = contact.lastMovementAt ? businessDate(contact.lastMovementAt) : 'Sem movimentações';
  return `<article class="business-contact-card">
    <div class="business-contact-head"><div><strong>${escapeHtml(contact.name)}</strong><span class="badge neutral">${typeLabel}</span></div><button class="danger-link" type="button" data-business-contact-delete="${contact.id}" data-contact-name="${escapeHtml(contact.name)}">Excluir</button></div>
    <p>${escapeHtml(contact.phone || contact.email || '')}${contact.phone && contact.email ? ` · ${escapeHtml(contact.email)}` : ''}</p>
    ${contact.notes ? `<small class="business-contact-notes">${escapeHtml(contact.notes)}</small>` : ''}
    <div class="business-contact-metrics">${movedMetric}<span>Pendente<strong>${money.format(Number(contact.pendingAmount || 0))}</strong></span><span>Última movimentação<strong>${lastMovement}</strong></span></div>
  </article>`;
}

function businessEntryRow(entry) {
  const status = entry.effectiveStatus || entry.status;
  const statusLabels = { PENDING: 'Prevista', OVERDUE: 'Vencida', SETTLED: entry.type === 'RECEIVABLE' ? 'Recebida' : 'Paga', CANCELLED: 'Cancelada' };
  const tone = status === 'OVERDUE' ? 'danger' : status === 'SETTLED' ? 'success' : status === 'CANCELLED' ? 'muted' : 'warning';
  const pending = entry.status === 'PENDING';
  return `<div class="business-entry-row">
    <span class="row-icon ${entry.type === 'RECEIVABLE' ? 'income-bg' : 'expense-bg'}">${entry.type === 'RECEIVABLE' ? '↓' : '↑'}</span>
    <div class="row-main"><div class="row-title">${escapeHtml(entry.title)}</div><div class="row-meta">${escapeHtml(entry.counterparty)} · ${businessDate(entry.dueDate)} · ${escapeHtml(entry.category?.name || '')}</div><span class="badge ${tone}">${statusLabels[status] || status}</span></div>
    <strong class="${entry.type === 'RECEIVABLE' ? 'income' : 'expense'}">${money.format(Number(entry.amount || 0))}</strong>
    ${pending ? `<div class="business-entry-actions"><button class="button compact-action" type="button" data-business-settle="${entry.id}">${entry.type === 'RECEIVABLE' ? 'Receber' : 'Pagar'}</button><button class="danger-link" type="button" data-business-cancel="${entry.id}">Cancelar</button></div>` : ''}
  </div>`;
}

function businessDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value));
}

function accountTab(id, label, activeTab) {
  return `<button class="${activeTab === id ? 'active' : ''}" type="button" data-account-tab="${id}">${label}</button>`;
}

function walletRow(wallet) {
  const typeLabel = wallet.type === 'BANK' ? 'Banco' : 'Carteira';
  const deleteLabel = `Excluir ${typeLabel.toLowerCase()} ${wallet.name}`;
  return `
    <div class="row account-row">
      <span class="row-icon neutral-bg">${icon('wallet')}</span>
      <div class="row-main">
        <div class="row-title">${escapeHtml(wallet.name)}</div>
        <div class="row-meta">${typeLabel} - ${scopeLabel()}</div>
      </div>
      <strong>${money.format(Number(wallet.balance || 0))}</strong>
      <button
        class="icon-button account-delete-button"
        type="button"
        data-account-delete="${escapeHtml(wallet.id)}"
        data-account-name="${escapeHtml(wallet.name)}"
        data-account-kind="${escapeHtml(typeLabel.toLowerCase())}"
        aria-label="${escapeHtml(deleteLabel)}"
      >x</button>
    </div>
  `;
}

function accountCardRows(cards) {
  return cards
    .map(
      (card) => `
        <div class="row account-row">
          <span class="row-icon neutral-bg">${icon('card')}</span>
          <div class="row-main">
            <div class="row-title">${escapeHtml(card.name)}</div>
            <div class="row-meta">Cartão de crédito - ${scopeLabel()}</div>
          </div>
          <div class="account-limits">
            <strong>${money.format(Number(card.currentBill || 0))}</strong>
            <small>Limite ${money.format(Number(card.limit || 0))}</small>
          </div>
        </div>
      `,
    )
    .join('') || '<p class="empty">Cadastre cartões para registrar gastos no crédito.</p>';
}

function manageModalHtml() {
  if (!state.manageModal) return '';
  const isCard = state.manageModal === 'card';
  const isWallet = state.manageModal === 'wallet';
  const title = isCard ? 'Novo cartão' : isWallet ? 'Nova carteira' : 'Nova conta';
  const form = isCard ? cardFormHtml() : walletFormHtml(isWallet ? 'WALLET' : 'BANK');

  return `
    <div class="sheet-backdrop" data-manage-modal-close></div>
    <section class="bottom-sheet manage-bottom-sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-handle"></div>
      <div class="panel-title sheet-title">
        <div>
          <span>${scopeLabel()}</span>
          <h2>${title}</h2>
        </div>
        <button class="icon-button" type="button" data-manage-modal-close aria-label="Fechar">x</button>
      </div>
      ${form}
    </section>
  `;
}

function walletFormHtml(type) {
  return `
    <form class="form" data-wallet-form>
      <label class="field">Nome<input name="name" required placeholder="Ex: Nubank, Inter, Dinheiro" /></label>
      <input type="hidden" name="type" value="${type}" />
      <label class="field">Saldo inicial<input name="balance" inputmode="decimal" placeholder="R$ 0,00" /></label>
      <button class="button" type="submit">${type === 'BANK' ? 'Salvar conta' : 'Salvar carteira'}</button>
    </form>
  `;
}

function cardFormHtml() {
  return `
    <form class="form" data-card-form>
      <label class="field">Nome<input name="name" required placeholder="Ex: Nubank crédito, Inter Black" /></label>
      <label class="field">Limite<input name="limit" inputmode="decimal" placeholder="R$ 0,00" /></label>
      <button class="button" type="submit">Salvar cartão</button>
    </form>
  `;
}

function whatsappStatusLabel() {
  const status = state.whatsappStatus?.status;
  const labels = {
    aguardando_qr: 'Aguardando QR',
    conectado: 'Conectado',
    iniciando: 'Iniciando',
    reconectando: 'Reconectando',
  };
  return labels[status] || 'Não consultado';
}

function whatsappHelpText() {
  const status = state.whatsappStatus?.status;
  if (status === 'aguardando_qr') return 'Escaneie o QR Code no WhatsApp para conectar.';
  if (status === 'conectado') return 'A API WhatsApp está pronta para enviar mensagens.';
  if (status === 'iniciando' || status === 'reconectando') return 'Aguarde alguns instantes e atualize o status.';
  return 'Consulte o status para verificar a conexão com a API WhatsApp.';
}
