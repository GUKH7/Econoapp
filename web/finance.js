import { state } from './state.js';

export function transactionScope(transaction) {
  if (transaction.scope) return transaction.scope;
  if (state.scopes[transaction.id]) return state.scopes[transaction.id];
  if (transaction.channelId) return 'BUSINESS';
  return 'PERSONAL';
}

export function scopedTransactions() {
  return state.transactions.filter((transaction) => transactionScope(transaction) === state.scope);
}

export function scopedTotals() {
  return scopedTransactions().reduce(
    (acc, transaction) => {
      const value = Number(transaction.netAmount || transaction.amount || 0);
      if (transaction.type === 'INCOME') acc.income += value;
      if (transaction.type === 'EXPENSE') acc.expense += value;
      acc.balance = acc.income - acc.expense;
      return acc;
    },
    { income: 0, expense: 0, balance: 0 },
  );
}

export function scopeLabel() {
  return state.scope === 'BUSINESS' ? 'Negócio' : 'Pessoal';
}

export function totalsByCategory(type) {
  const byId = new Map(state.categories.map((category) => [category.id, { ...category, total: 0 }]));
  scopedTransactions()
    .filter((transaction) => transaction.type === type)
    .forEach((transaction) => {
      const category = byId.get(transaction.categoryId);
      if (category) category.total += Number(transaction.netAmount || transaction.amount || 0);
    });
  return [...byId.values()].filter((category) => category.total > 0);
}

export function paymentTargetFromValue(value) {
  const [kind, id] = String(value).split(':');
  if (kind === 'card') return { creditCardId: id };
  return { accountId: id };
}

export function paymentMetaFromValue(value, mode = 'PAYMENT') {
  const [kind, id] = String(value).split(':');
  if (kind === 'card') {
    const card = state.cards.find((item) => item.id === id);
    return { kind: 'CARD', id, label: card ? `Cartão ${card.name}` : 'Cartão' };
  }

  const wallet = state.wallets.find((item) => item.id === id);
  return {
    kind: wallet?.type || 'WALLET',
    id,
    label: wallet
      ? `${mode === 'RECEIVE' ? 'Receber em' : wallet.type === 'BANK' ? 'Banco' : 'Carteira'} ${wallet.name}`
      : 'Carteira',
  };
}

export function paymentMetaForTransaction(transaction) {
  if (transaction.creditCardId) {
    const card = state.cards.find((item) => item.id === transaction.creditCardId);
    return { label: card ? `Cartão ${card.name}` : 'Cartão' };
  }

  if (transaction.accountId) {
    const wallet = state.wallets.find((item) => item.id === transaction.accountId);
    if (!wallet) return { label: transaction.type === 'INCOME' ? 'Receber em conta' : 'Conta' };
    const prefix =
      transaction.type === 'INCOME' ? 'Receber em' : wallet.type === 'BANK' ? 'Banco' : 'Carteira';
    return { label: `${prefix} ${wallet.name}` };
  }

  return state.paymentMeta[transaction.id];
}
