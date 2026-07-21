
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const API_TOKEN = process.env.WHATSAPP_BOT_API_TOKEN || '';
const MAIN_API_TOKEN = process.env.WHATSAPP_MAIN_API_TOKEN || API_TOKEN;

function safeTokenEquals(received, expected) {
  if (!received || !expected) return false;

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function extractBearerToken(req) {
  const authorization = req.get('authorization') || '';

  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return req.get('x-api-token') || '';
}

function requireToken(expectedToken) {
  return (req, res, next) => {
    if (!expectedToken) {
      return res.status(503).json({ error: 'Token da API WhatsApp nao configurado.' });
    }

    if (!safeTokenEquals(extractBearerToken(req), expectedToken)) {
      return res.status(401).json({ error: 'Nao autorizado.' });
    }

    return next();
  };
}

const requireMainApiToken = requireToken(MAIN_API_TOKEN);
const requireEconoappApiToken = requireToken(API_TOKEN);

app.use('/econoapp', requireEconoappApiToken, async (req, res) => {
  const upstreamPath = req.originalUrl.replace(/^\/econoapp/, '') || '/';
  const upstreamUrl = 'http://127.0.0.1:3002' + upstreamPath;

  try {
    const init = {
      method: req.method,
      headers: {
        'content-type': 'application/json',
        authorization: req.get('authorization') || '',
        'x-idempotency-key': req.get('x-idempotency-key') || '',
      },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body || {});
    }

    const upstreamResponse = await fetch(upstreamUrl, init);
    const contentType = upstreamResponse.headers.get('content-type');
    const payload = await upstreamResponse.text();

    if (contentType) {
      res.setHeader('content-type', contentType);
    }

    res.status(upstreamResponse.status).send(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Falha ao chamar API econoapp.',
    });
  }
});

const AUTH_DIR = './baileys_auth_info';

let statusConexao = 'iniciando';
let qrCodeBase64 = '';
let sock = null;
let isConnecting = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function resetAuth() {
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error('Erro ao limpar sessão:', error);
  }
}

function scheduleReconnect(reason) {
  if (reconnectTimer || isConnecting) return;

  statusConexao = 'reconectando';
  qrCodeBase64 = '';

  const delay = Math.min(30000, 3000 + reconnectAttempts * 2000);
  reconnectAttempts += 1;

  console.log(`Reconectando em ${delay}ms. Motivo: ${reason}`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToWhatsApp().catch((error) => {
      console.error('Erro ao reconectar:', error);
      scheduleReconnect('erro ao reconectar');
    });
  }, delay);
}

async function connectToWhatsApp() {
  if (isConnecting) return;

  isConnecting = true;
  clearReconnectTimer();

  try {
    statusConexao = 'iniciando';

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const nextSock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['Meu ERP', 'Chrome', '1.0.0'],
    });

    sock = nextSock;
    nextSock.ev.on('creds.update', saveCreds);

    nextSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('QR Code gerado pelo Baileys.');
        statusConexao = 'aguardando_qr';

        try {
          qrCodeBase64 = await QRCode.toDataURL(qr);
        } catch (error) {
          console.error('Erro ao gerar QR Code:', error);
          qrCodeBase64 = '';
        }
      }

      if (connection === 'open') {
        console.log('WhatsApp conectado com sucesso.');
        reconnectAttempts = 0;
        statusConexao = 'conectado';
        qrCodeBase64 = '';
        return;
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        console.log('Conexão fechada.', {
          statusCode,
          isLoggedOut,
          message: lastDisconnect?.error?.message,
        });

        if (sock === nextSock) {
          sock = null;
        }

        qrCodeBase64 = '';

        if (isLoggedOut) {
          console.log('Sessão desconectada. Limpando auth para gerar novo QR.');
          resetAuth();
          reconnectAttempts = 0;
          scheduleReconnect('loggedOut');
          return;
        }

        scheduleReconnect(`close:${statusCode || 'unknown'}`);
      }
    });
  } catch (error) {
    console.error('Erro ao iniciar WhatsApp:', error);
    scheduleReconnect('erro no connectToWhatsApp');
  } finally {
    isConnecting = false;
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gestor-whatsapp-api' });
});

app.get('/status', requireMainApiToken, (req, res) => {
  res.json({ status: statusConexao, qrcode: qrCodeBase64 });
});

app.post('/restart', requireMainApiToken, (req, res) => {
  console.log('Comando de reinício recebido.');
  res.json({ message: 'Reiniciando conexão...' });

  clearReconnectTimer();
  statusConexao = 'iniciando';
  qrCodeBase64 = '';
  resetAuth();

  try {
    sock?.end?.(new Error('restart requested'));
  } catch {}

  sock = null;

  setTimeout(() => {
    connectToWhatsApp().catch((error) => {
      console.error('Erro após restart:', error);
      scheduleReconnect('restart error');
    });
  }, 1000);
});

app.post('/send-message', requireMainApiToken, async (req, res) => {
  const { phone, number, to, message, text } = req.body;
  const targetPhone = phone || number || to;
  const targetMessage = message || text;

  if (!targetPhone || !targetMessage) {
    return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios.' });
  }

  if (statusConexao !== 'conectado' || !sock) {
    return res.status(400).json({ error: 'WhatsApp não está pronto.' });
  }

  try {
    const numeroLimpo = String(targetPhone).replace(/\D/g, '');
    const id = `${numeroLimpo}@s.whatsapp.net`;

    await sock.sendMessage(id, { text: targetMessage });

    console.log(`Mensagem enviada para ${targetPhone}`);
    res.json({ success: true, message: 'Enviada com sucesso!' });
  } catch (error) {
    console.error('Erro ao enviar:', error);
    res.status(500).json({ error: 'Falha ao enviar a mensagem.' });
  }
});

connectToWhatsApp();

app.listen(3001, () => {
  console.log('API Baileys rodando na porta 3001.');
});
