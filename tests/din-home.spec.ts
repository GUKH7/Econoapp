import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  description: string;
  netAmount: number;
  date: string;
  scope: 'PERSONAL' | 'BUSINESS';
  source: string;
};
type HomeState = {
  scope: 'PERSONAL' | 'BUSINESS';
  transactions: Row[];
  categoryBudgets: Array<{ amount: number; spent: number; categoryName: string }>;
  businessSummary: null | {
    availableBalance: number;
    configuration: { revenueGoal: number };
    statement: { grossRevenue: number };
  };
};

let state: HomeState;
let render: () => string;

function row(type: Row['type'], amount: number, description: string, scope: Row['scope'] = 'PERSONAL'): Row {
  return {
    id: description + amount,
    type,
    description,
    netAmount: amount,
    date: new Date().toISOString(),
    scope,
    source: 'MANUAL',
  };
}

beforeAll(async () => {
  vi.stubGlobal('window', { ECONOAPP_CONFIG: {} });
  vi.stubGlobal('location', { origin: 'http://localhost:5173' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal('document', { querySelector: () => null });
  // Web modules are native browser JavaScript and do not ship TypeScript declarations.
  // @ts-expect-error: the PWA module does not have a declaration file.
  const stateModule = await import('../web/state.js');
  // @ts-expect-error: the PWA module does not have a declaration file.
  const homeModule = await import('../web/views/din-home.js');
  state = stateModule.state as HomeState;
  render = homeModule.dinHomeHtml as () => string;
});

beforeEach(() => {
  state.scope = 'PERSONAL';
  state.transactions = [];
  state.categoryBudgets = [];
  state.businessSummary = null;
});

describe('Din home redesign', () => {
  it('shows real income, expenses and free balance without a greeting or balance card', () => {
    state.transactions = [row('INCOME', 1800, 'Salário'), row('EXPENSE', 600, 'Mercado')];
    const html = render();
    const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    expect(html).toContain(brl.format(1200));
    expect(html).toContain(brl.format(1800));
    expect(html).toContain(brl.format(600));
    expect(html).toContain('din-balance');
    expect(html).not.toContain('balance-card');
    expect(html).not.toContain('Olá,');
    expect(html).toContain('Salário');
    expect(html).toContain('Mercado');
  });

  it('keeps quick actions linked to existing handlers and offers an honest empty state', () => {
    const html = render();
    expect(html).toContain('data-action-type="EXPENSE"');
    expect(html).toContain('data-action-type="TRANSFER"');
    expect(html).toContain('data-manage-section="cards"');
    expect(html).toContain('data-tab-jump="transactions"');
    expect(html).toContain('Registre lançamentos');
    expect(html).toContain('Sem base de comparação');
  });

  it('uses the separate business balance and never mixes personal transactions', () => {
    state.transactions = [row('INCOME', 1800, 'Pessoal'), row('EXPENSE', 50, 'Café'), row('INCOME', 1000, 'Venda', 'BUSINESS')];
    state.scope = 'BUSINESS';
    state.businessSummary = { availableBalance: 420, configuration: { revenueGoal: 2000 }, statement: { grossRevenue: 1000 } };
    const html = render();
    const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    expect(html).toContain(brl.format(420));
    expect(html).toContain('Venda');
    expect(html).not.toContain('Café');
    expect(html).toContain('50%');
  });

  it('renders actual personal budget progress without invented goals', () => {
    state.categoryBudgets = [{ categoryName: 'Alimentação', amount: 400, spent: 100 }];
    const html = render();
    expect(html).toContain('Alimentação');
    expect(html).toContain('25%');
    expect(html).toContain('aria-valuenow="25"');
  });
});
