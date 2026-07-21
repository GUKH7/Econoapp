
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
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

function requireApiToken(req, res, next) {
  if (!API_TOKEN) {
    return res.status(503).json({ error: 'WHATSAPP_BOT_API_TOKEN nao configurado.' });
  }

  if (!safeTokenEquals(extractBearerToken(req), API_TOKEN)) {
    return res.status(401).json({ error: 'Nao autorizado.' });
  }

  return next();
}

const AUTH_DIR = process.env.AUTH_DIR || './baileys_auth_info';
const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  'https://econoapp-backend.onrender.com/api/v1/whatsapp/webhook';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || WEBHOOK_TOKEN;
const DELIVERY_URL = process.env.DELIVERY_URL || WEBHOOK_URL.replace(/\/webhook\/?$/, '/delivery');
const SENT_CACHE_FILE = process.env.SENT_CACHE_FILE || './sent_message_ids.json';

const sentMessageIds = loadSentMessageIds();
const pendingSends = new Map();

function loadSentMessageIds() {
  try {
    const entries = JSON.parse(fs.readFileSync(SENT_CACHE_FILE, 'utf8'));
    return new Map(Array.isArray(entries) ? entries : []);
  } catch {
    return new Map();
  }
}

function rememberSentMessage(idempotencyKey, messageId) {
  if (!idempotencyKey || !messageId) return;
  sentMessageIds.set(idempotencyKey, messageId);
  const entries = [...sentMessageIds.entries()].slice(-5000);
  const temporaryFile = `${SENT_CACHE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(entries));
  fs.renameSync(temporaryFile, SENT_CACHE_FILE);
}

function stableMessageId(idempotencyKey) {
  return crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 20).toUpperCase();
}

function signedHeaders(body) {
  const timestamp = String(Date.now());
  const signature = `sha256=${crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(timestamp)
    .update('.')
    .update(body)
    .digest('hex')}`;
  return {
    'content-type': 'application/json',
    'x-whatsapp-timestamp': timestamp,
    'x-whatsapp-signature': signature,
    ...(WEBHOOK_TOKEN ? { 'x-whatsapp-webhook-token': WEBHOOK_TOKEN } : {}),
  };
}

async function postSignedJson(url, payload, timeout = 120000) {
  if (!WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET nao configurado.');
  const body = JSON.stringify(payload);
  return fetch(url, {
    method: 'POST',
    headers: signedHeaders(body),
    body,
    signal: AbortSignal.timeout(timeout),
  });
}

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

function unwrapMessageContent(message) {
  let content = message;

  while (content) {
    if (content.ephemeralMessage?.message) {
      content = content.ephemeralMessage.message;
      continue;
    }

    if (content.viewOnceMessage?.message) {
      content = content.viewOnceMessage.message;
      continue;
    }

    if (content.viewOnceMessageV2?.message) {
      content = content.viewOnceMessageV2.message;
      continue;
    }

    break;
  }

  return content || {};
}

function extractMessageText(message) {
  const content = unwrapMessageContent(message);
  const nativeParams = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  let nativeValue = '';
  if (nativeParams) {
    try {
      const parsed = JSON.parse(nativeParams);
      nativeValue = parsed.id || parsed.value || parsed.selectedId || '';
    } catch {}
  }
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.templateButtonReplyMessage?.selectedId ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    nativeValue ||
    ''
  ).trim();
}

function extractAudioMessage(message) {
  const content = unwrapMessageContent(message);
  return content.audioMessage || content.ptvMessage || null;
}

function extractImageMessage(message) {
  const content = unwrapMessageContent(message);
  return content.imageMessage || null;
}

async function downloadIncomingImage(incomingMessage) {
  const imageMessage = extractImageMessage(incomingMessage.message);
  if (!imageMessage) return null;
  const buffer = await downloadMediaMessage(
    incomingMessage,
    'buffer',
    {},
    { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage },
  );
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return {
    base64: buffer.toString('base64'),
    mimeType: imageMessage.mimetype || 'image/jpeg',
    caption: imageMessage.caption || '',
  };
}

async function downloadIncomingAudio(incomingMessage) {
  const audioMessage = extractAudioMessage(incomingMessage.message);
  if (!audioMessage) return null;

  const buffer = await downloadMediaMessage(
    incomingMessage,
    'buffer',
    {},
    {
      logger: pino({ level: 'silent' }),
      reuploadRequest: sock?.updateMediaMessage,
    },
  );

  if (!buffer || !Buffer.isBuffer(buffer)) {
    return null;
  }

  return {
    base64: buffer.toString('base64'),
    mimeType: audioMessage.mimetype || 'audio/ogg',
    seconds: audioMessage.seconds || null,
    ptt: Boolean(audioMessage.ptt),
  };
}

function buildWebhookFailureMessage(hasAudio) {
  const mediaLabel = hasAudio ? 'seu audio' : 'sua mensagem';

  return [
    `⚠️ Recebi ${mediaLabel}, mas o Din demorou para processar agora.`,
    '',
    'Pode tentar enviar novamente em instantes ou escrever em texto?',
  ].join('\n');
}

async function sendWebhookFailureFallback(remoteJid, hasAudio) {
  if (!sock || !remoteJid) return;

  try {
    await sock.sendMessage(remoteJid, { text: buildWebhookFailureMessage(hasAudio) });
  } catch (error) {
    console.error('Erro ao enviar fallback de falha do webhook:', error);
  }
}

async function sendAudioReceivedAck(remoteJid) {
  if (!sock || !remoteJid) return;

  try {
    await sock.sendMessage(remoteJid, {
      text: '🎙️ Recebi seu audio. Vou analisar e ja te respondo.',
    });
  } catch (error) {
    console.error('Erro ao enviar confirmacao de recebimento do audio:', error);
  }
}

function isGroupOrBroadcastJid(jid) {
  return (
    !jid ||
    jid === 'status@broadcast' ||
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter')
  );
}

function phoneFromJid(jid) {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return '';
  return jid.replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
}

function resolveIncomingContact(messageKey) {
  const chatJid = messageKey.remoteJid || messageKey.remoteJidAlt || '';
  if (messageKey.fromMe || isGroupOrBroadcastJid(chatJid)) {
    return { ignored: true, chatJid, phone: '' };
  }
  const phone = [
    messageKey.remoteJid,
    messageKey.remoteJidAlt,
    messageKey.participant,
    messageKey.participantAlt,
  ].map(phoneFromJid).find(Boolean) || '';
  return { ignored: false, chatJid, phone };
}

async function forwardMessageToWebhook(incomingMessage) {
  const messageKey = incomingMessage?.key || {};
  const { ignored, chatJid, phone } = resolveIncomingContact(messageKey);
  if (ignored) return;

  const text = extractMessageText(incomingMessage.message);
  const image = await downloadIncomingImage(incomingMessage);
  const audio = image || text ? null : await downloadIncomingAudio(incomingMessage);
  if (!text && !audio && !image) return;

  if (!phone) {
    console.warn('Mensagem ignorada sem telefone confiavel.', {
      remoteJid: messageKey.remoteJid,
      remoteJidAlt: messageKey.remoteJidAlt,
    });
    return;
  }

  const webhookPayload = {
    from: phone,
    data: {
      messageId: incomingMessage.key?.id || null,
      timestamp: incomingMessage.messageTimestamp || null,
    },
  };

  if (text) {
    webhookPayload.text = text;
  }

  if (audio) {
    webhookPayload.messageType = 'audio';
    webhookPayload.audio = {
      base64: audio.base64,
      mimeType: audio.mimeType,
      seconds: audio.seconds,
      ptt: audio.ptt,
    };
  }

  if (image) {
    webhookPayload.messageType = 'image';
    webhookPayload.image = {
      base64: image.base64,
      mimeType: image.mimeType,
      caption: image.caption,
    };
  }

  try {
    const response = await postSignedJson(WEBHOOK_URL, webhookPayload);

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Webhook respondeu ${response.status}: ${responseBody.slice(0, 300)}`);
    }

    const responseBody = await response.text();

    console.log(
    `${audio ? 'Áudio' : 'Mensagem'} recebido de ${phone} encaminhado ao webhook (${response.status}): ${responseBody.slice(0, 200)}`,
    );
  } catch (error) {
    console.error('Erro ao encaminhar mensagem para o webhook:', error);
  }
}

function deliveryStatus(status) {
  if (status === 0) return 'FAILED';
  if (status === 2) return 'SENT';
  if (status === 3) return 'DELIVERED';
  if (status === 4 || status === 5) return 'READ';
  return null;
}

async function forwardDeliveryUpdates(updates) {
  for (const item of updates || []) {
    const messageId = item?.key?.id;
    const status = deliveryStatus(item?.update?.status);
    if (!item?.key?.fromMe || !messageId || !status) continue;
    try {
      const response = await postSignedJson(DELIVERY_URL, { messageId, status }, 10000);
      if (!response.ok) {
        throw new Error(`Callback de entrega respondeu ${response.status}`);
      }
    } catch (error) {
      console.error('Erro ao confirmar entrega ao backend:', error);
    }
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
    nextSock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const incomingMessage of messages || []) {
        try {
          await forwardMessageToWebhook(incomingMessage);
        } catch (error) {
          console.error('Erro ao encaminhar mensagem para o webhook:', error);
        }
      }
    });
    nextSock.ev.on('messages.update', forwardDeliveryUpdates);

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

app.get('/status', requireApiToken, (req, res) => {
  res.json({ status: statusConexao, qrcode: qrCodeBase64 });
});

app.get('/restart', requireApiToken, (req, res) => {
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

app.post('/send-message', requireApiToken, async (req, res) => {
  const {
    phone, number, to, message, text, interactions,
    audioBase64, audioMimeType, asVoice,
    idempotencyKey: bodyIdempotencyKey,
  } = req.body;
  const targetPhone = phone || number || to;
  const targetMessage = message || text;
  const idempotencyKey = String(req.get('x-idempotency-key') || bodyIdempotencyKey || '').trim();

  if (!targetPhone || (!targetMessage && !audioBase64)) {
    return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios.' });
  }

  if (statusConexao !== 'conectado' || !sock) {
    return res.status(400).json({ error: 'WhatsApp não está pronto.' });
  }

  try {
    const numeroLimpo = String(targetPhone).replace(/\D/g, '');
    const id = `${numeroLimpo}@s.whatsapp.net`;

    const cachedMessageId = idempotencyKey ? sentMessageIds.get(idempotencyKey) : '';
    if (cachedMessageId) {
      return res.json({ success: true, duplicate: true, messageId: cachedMessageId });
    }

    let sendPromise = idempotencyKey ? pendingSends.get(idempotencyKey) : null;
    if (!sendPromise) {
      const messageId = idempotencyKey ? stableMessageId(idempotencyKey) : undefined;
      const quickReplies = Array.isArray(interactions)
        ? interactions.filter((item) => item?.label && item?.value).slice(0, 3)
        : [];
      const content = audioBase64
        ? {
            audio: Buffer.from(String(audioBase64), 'base64'),
            mimetype: audioMimeType || 'audio/ogg; codecs=opus',
            ptt: asVoice !== false,
          }
        : quickReplies.length
        ? {
            text: targetMessage,
            interactiveButtons: quickReplies.map((item) => ({
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: String(item.label).slice(0, 20),
                id: String(item.value).slice(0, 100),
              }),
            })),
          }
        : { text: targetMessage };
      sendPromise = sock.sendMessage(id, content, messageId ? { messageId } : undefined);
      if (idempotencyKey) pendingSends.set(idempotencyKey, sendPromise);
    }

    const sentMessage = await sendPromise;
    const providerMessageId = sentMessage?.key?.id || (idempotencyKey ? stableMessageId(idempotencyKey) : '');
    rememberSentMessage(idempotencyKey, providerMessageId);
    if (idempotencyKey) pendingSends.delete(idempotencyKey);

    console.log(`Mensagem enviada para ${targetPhone}`);
    res.json({ success: true, messageId: providerMessageId });
  } catch (error) {
    if (idempotencyKey) pendingSends.delete(idempotencyKey);
    console.error('Erro ao enviar:', error);
    res.status(500).json({ error: 'Falha ao enviar a mensagem.' });
  }
});

connectToWhatsApp();

const PORT = Number(process.env.PORT || 3002);

app.listen(PORT, () => {
  console.log('API Baileys rodando na porta ' + PORT + '.');
});
