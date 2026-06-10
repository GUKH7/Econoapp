export { metricCard, balanceCard, tabButton, fabMenu } from './views/chrome.js';
export { dashboardView } from './views/dashboard.js';
export { transactionsView, transactionListHtml } from './views/transactions.js';
export { transactionSheet, launchView } from './views/transaction-form.js';
export { reportsView } from './views/reports.js';
export { budgetView, manageView, moreView } from './views/manage.js';

import { dashboardView } from './views/dashboard.js';
import { transactionsView } from './views/transactions.js';
import { launchView } from './views/transaction-form.js';
import { reportsView } from './views/reports.js';
import { budgetView, moreView } from './views/manage.js';
import { state } from './state.js';

export function viewHtml() {
  if (state.tab === 'transactions') return transactionsView();
  if (state.tab === 'reports') return reportsView();
  if (state.tab === 'budget') return budgetView();
  if (state.tab === 'more') return moreView();
  if (state.tab === 'launch') return launchView();
  return dashboardView();
}
