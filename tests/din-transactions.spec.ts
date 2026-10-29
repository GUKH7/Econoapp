import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TestTransaction = {
  id: string;
  description: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  netAmount: number;
  scope: 'PERSONAL' | 'BUSINESS';
  date: string;
  source: 'MANUAL';
  categoryId?: string;
};
type TestState = {
  scope: 'PERSONAL' | 'BUSINESS';
  transactions: TestTransaction[];
  transactionSearch: string;
  transactionFilter: 'ALL' | 'INCOME' | 'EXPENSE' | 'TRANSFER';
  categories: { id: string; name: string }[];
};
let state: TestState;
let render: () => string;
let renderOverview: () => string;

beforeAll(async () => {
  vi.stubGlobal('window', { ECONOAPP_CONFIG: {} });
  vi.stubGlobal('location', { origin: 'http://localhost:5173' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal('document', { querySelector: () => null });
  // @ts-expect-error PWA JavaScript files have no TypeScript declaration files.
  const stateModule = await import('../web/state.js');
  // @ts-expect-error PWA JavaScript files have no TypeScript declaration files.
  const transactionsModule = await import('../web/views/transactions.js');
  state = stateModule.state as TestState;
  render = transactionsModule.transactionsView as () => string;
  renderOverview = transactionsModule.transactionOverviewHtml as () => string;
});

const row = (id: string, type: 'INCOME' | 'EXPENSE', amount: number, description: string, scope: 'PERSONAL' | 'BUSINESS' = 'PERSONAL'): TestTransaction => ({
  id, type, amount, netAmount: amount, description, scope, source: 'MANUAL',
  date: id === 'earlier' ? '2026-02-01T12:00:00.000Z' : '2026-10-20T12:00:00.000Z',
});

beforeEach(() => {
  state.scope = 'PERSONAL';
  state.transactionSearch = '';
  state.transactionFilter = 'ALL';
  state.categories = [{ id: 'food', name: 'Alimentação' }];
  state.transactions = [
    row('earlier', 'INCOME', 3000, 'Salário'),
    row('recent', 'EXPENSE', 200, 'Mercado'),
    row('business', 'EXPENSE', 700, 'Fornecedor', 'BUSINESS'),
  ];
});

describe('Din 2.0 transactions', () => {
  it('shows a real scoped overview and avoids fake month navigation', () => {
    const html = render();
    const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    expect(html).toContain('2 lançamentos');
    expect(html).toContain(currency.format(3000));
    expect(html).toContain(currency.format(200));
    expect(html).not.toContain('Fornecedor');
    expect(html).not.toContain('period-switch');
    expect(html).toContain('data-transaction-search');
    expect(html).toContain('data-transaction-filter="EXPENSE"');
  });
  it('keeps totals consistent with income and expense filters', () => {
    state.transactionFilter = 'EXPENSE';
    const html = renderOverview();
    expect(html).toContain('1 lançamento');
    expect(html).toContain('aria-label="Resumo dos lançamentos filtrados"');
    expect(html).toContain('R$');
    expect(html).not.toContain('3.000,00');
    expect(render()).toContain('aria-pressed="true" data-transaction-filter="EXPENSE"');
  });
  it('updates overview for search and preserves finance scope boundaries', () => {
    state.transactionSearch = 'mercado';
    expect(renderOverview()).toContain('1 lançamento');
    state.transactionSearch = 'fornecedor';
    expect(renderOverview()).toContain('0 lançamentos');
    state.scope = 'BUSINESS';
    expect(renderOverview()).toContain('1 lançamento');
    expect(render()).toContain('Fornecedor');
    expect(render()).not.toContain('Mercado');
  });
  it('sorts the timeline newest first without changing stored order', () => {
    const html = render();
    expect(html.indexOf('Mercado')).toBeLessThan(html.indexOf('Salário'));
    expect(state.transactions[0].id).toBe('earlier');
  });
  it('escapes untrusted search input in the interface', () => {
    state.transactionSearch = '<img src=x onerror=alert(1)>';
    expect(render()).not.toContain('<img src=x');
  });
});
