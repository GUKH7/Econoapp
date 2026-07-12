import { createServer } from 'node:http';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(rootDir, 'web');
const outputDir = path.join(rootDir, 'test-results', 'visual');

function currentMonthDate(day = 1) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12)).toISOString();
}

const categories = [
  { id: 'cat-food', name: 'Alimentacao', color: '#22C55E' },
  { id: 'cat-home', name: 'Moradia', color: '#3B82F6' },
  { id: 'cat-transport', name: 'Transporte', color: '#F59E0B' },
  { id: 'cat-sales', name: 'Vendas', color: '#166534' },
  { id: 'cat-salary', name: 'Salario', color: '#22C55E' },
];

const categoryKinds = categories.reduce((acc, category) => {
  acc[category.id] = category.id === 'cat-sales' || category.id === 'cat-salary' ? 'INCOME' : 'EXPENSE';
  return acc;
}, {});

const transactions = [
  {
    id: 'tx-1',
    description: 'Salario',
    amount: 4500,
    netAmount: 4500,
    type: 'INCOME',
    source: 'MANUAL',
    scope: 'PERSONAL',
    categoryId: 'cat-salary',
    accountId: 'acc-main',
    date: currentMonthDate(3),
  },
  {
    id: 'tx-2',
    description: 'Supermercado',
    amount: 312.9,
    netAmount: 312.9,
    type: 'EXPENSE',
    source: 'MANUAL',
    scope: 'PERSONAL',
    categoryId: 'cat-food',
    creditCardId: 'card-main',
    date: currentMonthDate(4),
  },
  {
    id: 'tx-3',
    description: 'Aluguel',
    amount: 1200,
    netAmount: 1200,
    type: 'EXPENSE',
    source: 'MANUAL',
    scope: 'PERSONAL',
    categoryId: 'cat-home',
    accountId: 'acc-main',
    date: currentMonthDate(5),
  },
  {
    id: 'tx-4',
    description: 'Uber',
    amount: 86.5,
    netAmount: 86.5,
    type: 'EXPENSE',
    source: 'MANUAL',
    scope: 'PERSONAL',
    categoryId: 'cat-transport',
    creditCardId: 'card-main',
    date: currentMonthDate(6),
  },
  {
    id: 'tx-5',
    description: 'Venda loja online',
    amount: 2600,
    netAmount: 2600,
    type: 'INCOME',
    source: 'MANUAL',
    scope: 'BUSINESS',
    categoryId: 'cat-sales',
    channelId: 'channel-store',
    accountId: 'acc-business',
    date: currentMonthDate(7),
  },
];

const apiFixtures = {
  '/api/v1/auth/me': {
    data: {
      id: 'user-visual',
      name: 'Gustavo Keio Hirakawa',
      phone: '11999990001',
      email: 'gustavo@example.com',
    },
  },
  '/api/v1/auth/forgot-password': { data: { accepted: true } },
  '/api/v1/auth/me/export': { data: { profile: { id: 'user-visual' }, transactions } },
  '/api/v1/dashboard': { data: {} },
  '/api/v1/transactions': { data: transactions },
  '/api/v1/categories': { data: categories },
  '/api/v1/channels': { data: [{ id: 'channel-store', name: 'Loja online', feePercent: 4.5 }] },
  '/api/v1/accounts': {
    data: [
      { id: 'acc-main', name: 'Conta Principal', type: 'BANK', balance: 5400, scope: 'PERSONAL' },
      { id: 'acc-business', name: 'Conta Negocio', type: 'BANK', balance: 2600, scope: 'BUSINESS' },
    ],
  },
  '/api/v1/accounts/cards': {
    data: [{ id: 'card-main', name: 'Nubank', limit: 5000, scope: 'PERSONAL' }],
  },
  '/api/v1/budgets': {
    data: {
      scope: 'PERSONAL',
      month: currentMonthDate(1),
      totalLimit: 2300,
      totalSpent: 1599.4,
      items: [
        {
          id: 'budget-food',
          categoryId: 'cat-food',
          categoryName: 'Alimentacao',
          categoryColor: '#22C55E',
          scope: 'PERSONAL',
          month: currentMonthDate(1),
          amount: 800,
          spent: 312.9,
          percentage: 39,
        },
        {
          id: 'budget-home',
          categoryId: 'cat-home',
          categoryName: 'Moradia',
          categoryColor: '#3B82F6',
          scope: 'PERSONAL',
          month: currentMonthDate(1),
          amount: 1500,
          spent: 1200,
          percentage: 80,
        },
      ],
    },
  },
  '/api/v1/transactions/recurring': { data: [] },
  '/api/v1/assistant/activity': {
    data: {
      messages: [
        { role: 'user', text: 'Gastei 5,30 de passagem hoje' },
        { role: 'assistant', text: 'Despesa pronta para salvar\nTipo: Despesa\nTítulo: Gasto com passagem\nValor: R$ 5,30\nCategoria: Transporte\nPagamento: Dinheiro' },
      ],
      events: [],
    },
  },
};

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const relativePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
      const filePath = path.resolve(webDir, relativePath);
      if (!filePath.startsWith(webDir)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error('Playwright nao esta instalado. Rode: npm install && npx playwright install chromium');
  }
}

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known browser path.
    }
  }
  return '';
}

async function launchBrowser(chromium) {
  const launchOptions = { headless: process.env.VISUAL_HEADLESS !== 'false', timeout: 30000 };
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    if (!String(error.message).includes("Executable doesn't exist")) throw error;
    const chromePath = await firstExistingPath([
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean));

    if (!chromePath) {
      throw new Error('Chromium do Playwright nao esta instalado e nenhum Chrome/Edge local foi encontrado. Rode: npx playwright install chromium');
    }

    console.log(`Chromium do Playwright ausente. Usando navegador local: ${chromePath}`);
    return chromium.launch({ ...launchOptions, executablePath: chromePath });
  }
}

async function assertVisible(page, selector, label) {
  const element = page.locator(selector);
  await element.waitFor({ state: 'visible', timeout: 8000 });
  const visible = await element.isVisible();
  if (!visible) throw new Error(`Elemento nao visivel: ${label}`);
}

async function assertText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
}

async function screenshot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

async function viewportScreenshot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });
}

async function screenshotBottomViewport(page, name) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await viewportScreenshot(page, `${name}-bottom`);
}

async function disableMotion(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0.001s !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0.001s !important;
      }
      ::view-transition-old(root),
      ::view-transition-new(root) {
        animation: none !important;
      }
    `,
  });
}

async function routeApi(page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const fixture = apiFixtures[url.pathname];
    if (!fixture) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Mock ausente' }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
  });
}

async function prepareSession(page) {
  await page.addInitScript((storedCategoryKinds) => {
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: undefined,
    });
    localStorage.setItem('econoapp.accessToken', 'visual-access-token');
    localStorage.setItem('econoapp.refreshToken', 'visual-refresh-token');
    localStorage.setItem('econoapp.onboardingDismissed', 'true');
    localStorage.setItem('econoapp.categoryKinds', JSON.stringify(storedCategoryKinds));
  }, categoryKinds);
}

async function assertAccessibilityBasics(page, name) {
  const issues = await page.evaluate(() => {
    const problems = [];
    if (document.documentElement.lang !== 'pt-BR') problems.push('idioma da página');
    if (!document.querySelector('main')) problems.push('conteúdo principal');
    document.querySelectorAll('img').forEach((item) => {
      if (!item.hasAttribute('alt')) problems.push(`imagem sem alt: ${item.getAttribute('src') || ''}`);
    });
    document.querySelectorAll('button, summary').forEach((item) => {
      if (!(item.textContent || '').trim() && !item.getAttribute('aria-label')) problems.push('controle sem nome');
    });
    document.querySelectorAll('input, select, textarea').forEach((item) => {
      const label = item.closest('label')?.textContent?.trim();
      if (!label && !item.getAttribute('aria-label') && !item.getAttribute('placeholder')) problems.push(`campo sem nome: ${item.getAttribute('name') || ''}`);
    });
    return problems;
  });
  if (issues.length) throw new Error(`Falhas básicas de acessibilidade em ${name}: ${issues.join(', ')}`);
}

async function runViewport(browser, baseUrl, name, viewport) {
  console.log(`Verificando viewport ${name} (${viewport.width}x${viewport.height})...`);
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport,
    deviceScaleFactor: viewport.width < 500 ? 2 : 1,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.setDefaultTimeout(10000);

  await prepareSession(page);
  await routeApi(page);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await disableMotion(page);

  await assertText(page, 'Resumo');
  await assertAccessibilityBasics(page, name);
  await assertVisible(page, '.balance-card', 'card de saldo');
  await screenshot(page, `${name}-dashboard`);
  await screenshotBottomViewport(page, `${name}-dashboard`);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.locator('nav.tabs [data-tab="transactions"]').click();
  await assertVisible(page, '[data-transaction-search]', 'busca de lancamentos');
  if (await page.locator('.transaction-tools').count()) {
    throw new Error(`Ferramentas administrativas ainda aparecem em Transações em ${name}`);
  }
  await screenshot(page, `${name}-transactions`);

  await page.locator('nav.tabs [data-tab="more"]').click();
  await assertText(page, 'Automação e dados');
  await assertText(page, 'Importar e exportar');
  const closedTransactionTools = await page.locator('.transaction-tool:not([open])').count();
  if (closedTransactionTools !== 2) {
    throw new Error(`Ferramentas de transacao deveriam iniciar recolhidas em ${name}`);
  }
  await screenshot(page, `${name}-more`);

  await page.locator('[data-tab-jump="assistant"]').click();
  await assertText(page, 'App e WhatsApp');
  await assertVisible(page, '.assistant-finance-card', 'cartao financeiro do Din');
  const assistantOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (assistantOverflow > 1) {
    throw new Error(`Tela do Din excede o viewport em ${assistantOverflow}px em ${name}`);
  }
  await screenshot(page, `${name}-assistant`);

  await page.locator('nav.tabs [data-tab="reports"]').click();
  await assertText(page, 'Por categoria');
  await assertVisible(page, '.donut-chart', 'grafico donut');
  await assertText(page, 'Maior categoria');
  await screenshot(page, `${name}-reports-expenses`);
  await screenshotBottomViewport(page, `${name}-reports-expenses`);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.locator('[data-report-type="INCOME"]').click();
  await assertText(page, 'Receitas');
  await assertText(page, 'Salario');
  await screenshot(page, `${name}-reports-income`);

  const donutBackground = await page.locator('.donut-chart').evaluate((element) => getComputedStyle(element).backgroundImage);
  if (!donutBackground.includes('conic-gradient')) {
    throw new Error(`Grafico donut sem conic-gradient em ${name}`);
  }

  const categoryRows = await page.locator('.category-row').count();
  if (categoryRows < 1) {
    throw new Error(`Nenhuma categoria renderizada em ${name}`);
  }

  await page.locator('nav.tabs [data-tab="more"]').click();
  await page.locator('[data-tab-jump="budget"]').click();
  await assertText(page, 'Limite Pessoal');
  await assertText(page, 'Alimentacao');
  await assertText(page, 'Moradia');
  await assertVisible(page, '[data-budget-form]', 'formulario de orcamento');
  await screenshot(page, `${name}-budgets`);

  const budgetRows = await page.locator('[data-budget-delete]').count();
  if (budgetRows !== 2) {
    throw new Error(`Quantidade inesperada de orcamentos em ${name}: ${budgetRows}`);
  }

  await context.close();

  if (consoleErrors.length) {
    throw new Error(`Erros no console em ${name}: ${consoleErrors.join(' | ')}`);
  }
}

async function runAuthViewport(browser, baseUrl) {
  console.log('Verificando identidade no login mobile...');
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await routeApi(page);
  await assertVisible(page, '.din-logo', 'logo Din no login');
  await assertAccessibilityBasics(page, 'login');
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill('gustavo@example.com');
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await assertText(page, 'Confira seu e-mail');
  await screenshot(page, 'mobile-login');
  await context.close();
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  console.log('Carregando Playwright...');
  const { chromium } = await loadPlaywright();
  const { server, baseUrl } = await startStaticServer();
  console.log(`Servidor visual em ${baseUrl}`);
  let browser;

  try {
    browser = await launchBrowser(chromium);
    await runAuthViewport(browser, baseUrl);
    await runViewport(browser, baseUrl, 'mobile', { width: 390, height: 844 });
    await runViewport(browser, baseUrl, 'desktop', { width: 1024, height: 900 });
    console.log(`Verificacao visual concluida. Screenshots em ${path.relative(rootDir, outputDir)}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await Promise.race([
  main(),
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout global da verificacao visual.')), 120000);
  }),
]).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
