import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

const steps = [
  { key: 'businessType', title: 'Qual é o tipo de negócio?', copy: 'Isso ajuda o Din a sugerir categorias e indicadores mais úteis.' },
  { key: 'salesChannels', title: 'Onde você vende?', copy: 'Escolha todos os canais que fazem parte da sua operação.' },
  { key: 'recurringExpenses', title: 'Quais despesas se repetem?', copy: 'Vamos preparar essas categorias como despesas fixas mensais.' },
  { key: 'receivingMethods', title: 'Como você recebe?', copy: 'O Din usará isso para organizar seus recebimentos.' },
  { key: 'revenueGoal', title: 'Qual é a meta de faturamento?', copy: 'Ela aparecerá no dashboard e na previsão de fechamento.' },
  { key: 'taxes', title: 'Deseja reservar para impostos?', copy: 'A reserva será descontada apenas no resultado estimado.' },
];

const businessTypes = [
  ['COMMERCE', 'Comércio'], ['SERVICES', 'Serviços'], ['FOOD', 'Alimentação'],
  ['BEAUTY', 'Beleza e bem-estar'], ['FREELANCER', 'Profissional autônomo'], ['OTHER', 'Outro'],
];

export function businessOnboardingHtml() {
  if (!state.businessOnboardingOpen) return '';
  const stepIndex = state.businessOnboardingStep;
  const step = steps[stepIndex];
  const draft = state.businessOnboardingDraft;
  return `
    <div class="business-onboarding-backdrop" data-business-onboarding role="presentation">
      <section class="business-onboarding" role="dialog" aria-modal="true" aria-labelledby="business-onboarding-title">
        <div class="business-onboarding-brand"><img src="./assets/din-mark.svg" alt="" /><div><span>Configurar Negócio</span><strong>Din para empresas</strong></div><button type="button" data-business-onboarding-cancel aria-label="Fechar">×</button></div>
        <div class="business-onboarding-progress" aria-label="Etapa ${stepIndex + 1} de ${steps.length}"><span style="width:${((stepIndex + 1) / steps.length) * 100}%"></span></div>
        <div class="business-onboarding-copy"><span class="eyebrow">Etapa ${stepIndex + 1} de ${steps.length}</span><h2 id="business-onboarding-title">${step.title}</h2><p>${step.copy}</p></div>
        <form data-business-onboarding-form data-step="${step.key}">
          ${stepContent(step.key, draft)}
          <p class="form-error hidden" data-business-onboarding-error role="alert"></p>
          <div class="business-onboarding-actions">
            ${stepIndex ? '<button class="button secondary" type="button" data-business-onboarding-back>Voltar</button>' : '<button class="button secondary" type="button" data-business-onboarding-cancel>Agora não</button>'}
            <button class="button" type="submit">${stepIndex === steps.length - 1 ? 'Concluir configuração' : 'Continuar'}</button>
          </div>
        </form>
      </section>
    </div>`;
}

function stepContent(key, draft) {
  if (key === 'businessType') return choices('businessType', businessTypes, [draft.businessType], false);
  if (key === 'salesChannels') return choices('salesChannels', ['WhatsApp', 'Instagram', 'Loja física', 'Site próprio', 'Marketplace', 'Indicação'], draft.salesChannels, true);
  if (key === 'recurringExpenses') return `${choices('recurringExpenses', ['Aluguel', 'Energia e internet', 'Salários e prestadores', 'Ferramentas e sistemas', 'Marketing', 'Contabilidade'], draft.recurringExpenses, true)}<p class="field-hint">Se ainda não souber, pode continuar sem selecionar.</p>`;
  if (key === 'receivingMethods') return choices('receivingMethods', ['Pix', 'Dinheiro', 'Cartão', 'Boleto', 'Transferência bancária'], draft.receivingMethods, true);
  if (key === 'revenueGoal') return `<label class="business-goal-field"><span>Meta mensal</span><div><span>R$</span><input name="revenueGoal" inputmode="decimal" value="${escapeHtml(draft.revenueGoal)}" placeholder="10.000,00" autofocus /></div></label>`;
  return `<div class="business-tax-choice">${choices('reserveTaxes', [['true', 'Sim, quero reservar'], ['false', 'Não por enquanto']], [String(draft.reserveTaxes)], false)}<label class="business-tax-rate ${draft.reserveTaxes ? '' : 'hidden'}" data-business-tax-rate><span>Percentual estimado</span><div><input name="taxRate" inputmode="decimal" value="${escapeHtml(draft.taxRate)}" /><span>%</span></div></label></div>`;
}

function choices(name, options, selected, multiple) {
  const normalized = options.map((item) => Array.isArray(item) ? item : [item, item]);
  return `<div class="business-choice-grid">${normalized.map(([value, label]) => {
    const checked = selected.includes(value);
    return `<label class="business-choice ${checked ? 'selected' : ''}"><input type="${multiple ? 'checkbox' : 'radio'}" name="${name}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''} /><span class="business-choice-check">${multiple ? '✓' : ''}</span><strong>${escapeHtml(label)}</strong></label>`;
  }).join('')}</div>`;
}
