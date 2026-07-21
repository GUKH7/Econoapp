import process from 'node:process';
import { createHmac } from 'node:crypto';

const backendUrl = (process.env.E2E_BACKEND_URL || 'https://econoapp-backend.onrender.com').replace(
  /\/+$/,
  '',
);
const apiUrl = `${backendUrl}/api/v1`;
const oracleUrl = (
  process.env.E2E_ORACLE_URL || 'http://64.181.189.107:3001/econoapp'
).replace(/\/+$/, '');
const webhookToken = process.env.E2E_WEBHOOK_TOKEN || '';
const userPhone = digits(process.env.E2E_USER_PHONE || '');
const userPassword = process.env.E2E_USER_PASSWORD || '';
const recipientPhone = digits(process.env.E2E_WHATSAPP_RECIPIENT || '');
const liveInbound = process.argv.includes('--live-inbound');
const startedAt = new Date();
const amount = Number(`1.${String(Date.now()).slice(-2).padStart(2, '0')}`);
const marker = `E2E-${Date.now().toString(36).toUpperCase()}`;
const message = `Gastei R$ ${amount.toFixed(2).replace('.', ',')} com teste automatizado ${marker}, despesa pessoal`;

const report = {
  startedAt: startedAt.toISOString(),
  backendUrl,
  oracleUrl,
  mode: liveInbound ? 'live-inbound' : 'synthetic-webhook',
  checks: [],
};

let accessToken = '';
let createdTransaction = null;

try {
  requireEnv('E2E_USER_PHONE', userPhone);
  requireEnv('E2E_USER_PASSWORD', userPassword);
  if (!liveInbound) requireEnv('E2E_WEBHOOK_TOKEN', webhookToken);

  await check('Render health', async () => {
    const started = Date.now();
    const response = await request(`${backendUrl}/health`, { timeoutMs: 90_000 });
    return { latencyMs: Date.now() - started, status: response.status };
  });

  await check('Oracle WhatsApp status', async () => {
    const response = await request(`${oracleUrl}/status`, { timeoutMs: 20_000 });
    const status = normalizeStatus(response.body);
    if (status !== 'conectado') {
      throw new Error(`Oracle respondeu com status "${status}"`);
    }
    return { status };
  });

  await check('Render authentication', async () => {
    const response = await request(`${apiUrl}/auth/login`, {
      method: 'POST',
      body: { phone: userPhone, password: userPassword },
      timeoutMs: 90_000,
    });
    accessToken = response.body?.data?.accessToken || '';
    if (!accessToken) throw new Error('Login não retornou accessToken');
    return { authenticated: true };
  });

  if (liveInbound) {
    console.log('\nTESTE DE ENTRADA REAL');
    console.log(`Envie agora, pelo WhatsApp ${userPhone}, esta mensagem ao número do EconoApp:`);
    console.log(`\n${message}\n`);
    console.log('Conclua no WhatsApp qualquer pergunta de conta/categoria e confirme o lançamento.');
  } else {
    await check('Webhook Render -> processamento conversacional', async () => {
      const replies = await completeWebhookConversation(message);
      return { replies };
    });
  }

  await check(
    liveInbound ? 'WhatsApp -> Oracle -> Render -> banco' : 'Render webhook -> banco',
    async () => {
      createdTransaction = await waitForTransaction(liveInbound ? 240_000 : 60_000);
      return {
        transactionId: createdTransaction.id,
        source: createdTransaction.source,
        amount: Number(createdTransaction.amount),
      };
    },
  );

  if (recipientPhone) {
    await check('Render -> Oracle -> WhatsApp real', async () => {
      const response = await request(`${apiUrl}/whatsapp/send-message`, {
        method: 'POST',
        headers: authHeaders(),
        body: {
          phone: recipientPhone,
          message: `Teste E2E EconoApp concluído: ${marker}`,
        },
        timeoutMs: 30_000,
      });
      return { accepted: true, providerResponse: response.body?.data ?? response.body };
    });
  } else {
    report.checks.push({
      name: 'Render -> Oracle -> WhatsApp real',
      status: 'skipped',
      reason: 'E2E_WHATSAPP_RECIPIENT não informado',
    });
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (createdTransaction?.id && accessToken) {
    try {
      await request(`${apiUrl}/transactions/${createdTransaction.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
        timeoutMs: 30_000,
      });
      report.cleanup = { status: 'passed', transactionId: createdTransaction.id };
    } catch (error) {
      report.cleanup = {
        status: 'failed',
        transactionId: createdTransaction.id,
        error: error instanceof Error ? error.message : String(error),
      };
      process.exitCode = 1;
    }
  } else if (!liveInbound && accessToken) {
    try {
      await sendWebhook('Cancelar');
      report.conversationCleanup = { status: 'passed' };
    } catch {
      report.conversationCleanup = { status: 'skipped' };
    }
  }

  report.finishedAt = new Date().toISOString();
  console.log('\nE2E_REPORT');
  console.log(JSON.stringify(report, null, 2));
}

async function completeWebhookConversation(initialMessage) {
  const replies = [];
  let currentMessage = initialMessage;

  for (let step = 0; step < 6; step += 1) {
    const messageId = `${marker}-${step}`;
    const sentAt = new Date();
    const response = await sendWebhook(currentMessage, messageId);
    if (response.status !== 202 || response.body?.data?.messageId !== messageId) {
      throw new Error(`Webhook assíncrono não confirmou ${messageId}`);
    }
    if (step === 0) {
      const duplicate = await sendWebhook(currentMessage, messageId);
      if (duplicate.body?.data?.duplicate !== true) {
        throw new Error('Webhook repetido não foi reconhecido como duplicado');
      }
    }
    const reply = await waitForAssistantReply(sentAt, 60_000);
    replies.push(reply);
    const normalized = normalize(reply);

    if (normalized.includes('lancamento registrado')) return replies;
    if (normalized.includes('responda: confirmar') || normalized.includes('confirme o lancamento')) {
      currentMessage = 'Confirmar';
      continue;
    }
    if (
      normalized.includes('como voce pagou') ||
      normalized.includes('em qual conta') ||
      normalized.includes('responda com o numero')
    ) {
      currentMessage = '1';
      continue;
    }
    if (normalized.includes('com o que foi esse gasto')) {
      currentMessage = `Teste automatizado ${marker}`;
      continue;
    }
    if (normalized.includes('pessoal ou negocio')) {
      currentMessage = 'Pessoal';
      continue;
    }

    throw new Error(`Resposta inesperada do chatbot: ${reply}`);
  }

  throw new Error('O chatbot não concluiu o lançamento dentro de 6 etapas');
}

async function sendWebhook(text, messageId = `${marker}-${Date.now()}`) {
  const body = JSON.stringify({
    phone: userPhone,
    message: text,
    data: { messageId, timestamp: Date.now() },
  });
  const timestamp = String(Date.now());
  const signature = `sha256=${createHmac('sha256', webhookToken)
    .update(timestamp)
    .update('.')
    .update(body)
    .digest('hex')}`;
  return request(`${apiUrl}/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'x-whatsapp-timestamp': timestamp,
      'x-whatsapp-signature': signature,
    },
    rawBody: body,
    timeoutMs: 90_000,
  });
}

async function waitForAssistantReply(since, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await request(`${apiUrl}/assistant/activity`, {
      headers: authHeaders(),
      timeoutMs: 30_000,
    });
    const event = (response.body?.data?.events || []).find(
      (item) =>
        item.channel === 'WHATSAPP' &&
        item.status === 'PROCESSED' &&
        item.replyText &&
        new Date(item.createdAt).getTime() >= since.getTime(),
    );
    if (event) return String(event.replyText);
    await sleep(1_000);
  }
  throw new Error('A fila não produziu resposta do assistente dentro do prazo');
}

async function waitForTransaction(timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await request(
      `${apiUrl}/transactions?startDate=${encodeURIComponent(startedAt.toISOString())}&limit=100`,
      {
        headers: authHeaders(),
        timeoutMs: 30_000,
      },
    );
    const transaction = (response.body?.data || []).find(
      (item) =>
        item.source === 'WHATSAPP' &&
        Math.abs(Number(item.amount) - amount) < 0.001 &&
        new Date(item.createdAt).getTime() >= startedAt.getTime(),
    );
    if (transaction) return transaction;
    await sleep(5_000);
  }

  throw new Error(`Nenhuma transação WHATSAPP de R$ ${amount.toFixed(2)} apareceu no banco`);
}

async function check(name, operation) {
  const started = Date.now();
  try {
    const details = await operation();
    report.checks.push({ name, status: 'passed', durationMs: Date.now() - started, details });
    console.log(`PASS ${name}`);
    return details;
  } catch (error) {
    report.checks.push({
      name,
      status: 'failed',
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body || options.rawBody ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders() {
  return { Authorization: `Bearer ${accessToken}` };
}

function normalizeStatus(body) {
  const value = body?.status ?? body?.data?.status ?? 'desconhecido';
  return normalize(String(value)).replaceAll(' ', '_');
}

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function digits(value) {
  return value.replace(/\D/g, '');
}

function requireEnv(name, value) {
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
