import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string; scope: 'PERSONAL' | 'BUSINESS'; date: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER'; netAmount: number;
  amount: number;
};
type DemoState = {
  scope: 'PERSONAL' | 'BUSINESS'; cards: Array<{id:string;name:string;limit:number;currentBill:number;scope:string}>;
  categoryBudgets: Array<{id:string;categoryName:string;amount:number;spent:number;scope:string}>;
  categories: Array<{id:string;name:string}>; transactions: Row[];
  businessSummary: unknown; planningExpenseAdjustment: number;
};
let state: DemoState;
let cards: () => string;
let goals: () => string;
let planning: () => string;
let projection: (scope:string, rows:Row[], date?:Date, adjustment?:number) => {
  sampledMonths:number; income:number; expense:number; monthlyResult:number;
  projection:Array<{cumulative:number}>;
};

beforeAll(async () => {
  vi.stubGlobal('window', { ECONOAPP_CONFIG: {} });
  vi.stubGlobal('location', { origin: 'http://localhost' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal('document', { querySelector: () => null });
  // @ts-expect-error PWA module is a native JS module without declarations.
  state = (await import('../web/state.js')).state as DemoState;
  // @ts-expect-error PWA module is a native JS module without declarations.
  const financial = await import('../web/views/din-financial.js');
  cards = financial.cardsView as () => string;
  goals = financial.goalsView as () => string;
  planning = financial.planningView as () => string;
  projection = financial.planningForecast as typeof projection;
});

beforeEach(() => {
  state.scope='PERSONAL';
  state.cards=[];
  state.transactions=[];
  state.categoryBudgets=[];
  state.categories=[];
  state.businessSummary=null;
  state.planningExpenseAdjustment=0;
});

function tx(id:string, scope:Row['scope'], type:Row['type'], amount:number, month:number): Row {
  return {id, scope, type, amount, netAmount:amount, date:new Date(2026,month,8,12).toISOString()};
}

describe('Din 2.0 financial workspace', () => {
  it('isolates cards by scope, escaping titles and never inventing card balances', () => {
    state.cards=[
      {id:'a',name:'<Minha conta>',limit:3000,currentBill:450,scope:'PERSONAL'},
      {id:'b',name:'Loja',limit:5000,currentBill:200,scope:'BUSINESS'},
    ];
    let html=cards();
    expect(html).toContain('R$');
    expect(html).toContain('450,00');
    expect(html).toContain('&lt;Minha conta&gt;');
    expect(html).not.toContain('<Minha conta>');
    expect(html).not.toContain('Loja');
    expect(html).toContain('data-card-form');
    state.scope='BUSINESS';
    html=cards();
    expect(html).toContain('Loja');
    expect(html).not.toContain('Minha conta');
  });

  it('supports budget creation, removal and business revenue goal via existing handlers', () => {
    state.categories=[{id:'food',name:'Alimentação'}];
    state.categoryBudgets=[{id:'budget-a',categoryName:'Alimentação',amount:1000,spent:250,scope:'PERSONAL'}];
    let html=goals();
    expect(html).toContain('25');
    expect(html).toContain('data-budget-form');
    expect(html).toContain('data-budget-delete="budget-a"');
    state.scope='BUSINESS';
    state.businessSummary={configuration:{revenueGoal:20000},statement:{grossRevenue:5000}};
    html=goals();
    expect(html).toContain('Meta de faturamento');
    expect(html).toContain('data-business-onboarding-edit');
    expect(html).not.toContain('data-budget-delete="budget-a"');
  });

  it('computes completed-month averages and scenario deltas without including current month', () => {
    const asOf = new Date(2026,9,20,12);
    const rows=[
      tx('income1','PERSONAL','INCOME',3000,6),
      tx('expense1','PERSONAL','EXPENSE',1000,6),
      tx('income2','PERSONAL','INCOME',5000,7),
      tx('expense2','PERSONAL','EXPENSE',2000,7),
      tx('business','BUSINESS','EXPENSE',9000,7),
      tx('current','PERSONAL','EXPENSE',10000,9),
      tx('transfer','PERSONAL','TRANSFER',2500,8),
    ];
    const base=projection('PERSONAL',rows,asOf,0);
    expect(base.sampledMonths).toBe(2);
    expect(base.income).toBe(4000);
    expect(base.expense).toBe(1500);
    expect(base.monthlyResult).toBe(2500);
    expect(base.projection[2]?.cumulative).toBe(7500);
    const more=projection('PERSONAL',rows,asOf,20);
    expect(more.expense).toBe(1800);
    expect(more.monthlyResult).toBe(2200);
    expect(rows).toHaveLength(7);
  });

  it('shows an honest empty state when no completed month is available', () => {
    const p=projection('PERSONAL',[],new Date(2026,9,20),0);
    expect(p.sampledMonths).toBe(0);
    expect(p.projection).toHaveLength(0);
    expect(planning()).toContain('Ainda não há lançamentos');
  });

  it('shows four accessible scenario options without saving user data', () => {
    state.transactions=[tx('a','PERSONAL','INCOME',4000,8),tx('b','PERSONAL','EXPENSE',3000,8)];
    let html=planning();
    for (const percent of ['-10','0','10','20']) expect(html).toContain('data-planning-adjustment="'+percent+'"');
    expect(html).toContain('Simule suas despesas');
    expect(html).not.toContain('din-mascot');
  });
});
