# Provedor WhatsApp do Din

O diretório versiona os dois processos executados na Oracle:

- `index.js`: conexão Baileys exclusiva do EconoApp, na porta 3002;
- `gateway.js`: gateway autenticado da porta 3001, que publica o prefixo `/econoapp`.

## Garantias do protocolo

- webhooks são assinados com HMAC-SHA256 sobre `timestamp + "." + corpo bruto`;
- o segredo nunca é enviado na URL;
- mensagens recebidas carregam o `messageId` original do WhatsApp;
- envios recebem uma chave de idempotência e reutilizam um `messageId` estável;
- o provedor não interpreta nem envia o texto financeiro retornado pelo webhook;
- confirmações `SENT`, `DELIVERED` e `READ` são devolvidas ao backend por callback assinado.

## Variáveis do provedor

- `WHATSAPP_BOT_API_TOKEN`: Bearer token usado pelo gateway;
- `WEBHOOK_URL`: endpoint HTTPS `/api/v1/whatsapp/webhook`;
- `WEBHOOK_SECRET`: segredo HMAC; se ausente, usa `WEBHOOK_TOKEN` durante a migração;
- `DELIVERY_URL`: callback HTTPS; por padrão troca `/webhook` por `/delivery`;
- `AUTH_DIR`: diretório persistente da sessão Baileys;
- `SENT_CACHE_FILE`: cache local das chaves idempotentes.

Nunca versionar o diretório de autenticação, tokens ou o cache de mensagens enviadas.

