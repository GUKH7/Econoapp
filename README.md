# EconoApp Backend

API backend do EconoApp para gestao financeira de microempreendedores, com suporte a:
- autenticacao JWT
- transacoes, categorias e canais de venda
- dashboard financeiro
- integracao com WhatsApp Cloud API
- bot Telegram
- IA com Google Gemini

## Stack

- Node.js + TypeScript
- NestJS
- Prisma ORM
- PostgreSQL
- Vitest
- Docker Compose

## Requisitos

- Node.js 20+
- npm 10+
- Docker e Docker Compose (opcional, recomendado)
- Banco PostgreSQL (se rodar sem Docker)

## Estrutura principal

- `src/modules/auth`: login, registro, refresh, perfil
- `src/modules/transactions`: CRUD de transacoes
- `src/modules/categories`: CRUD de categorias
- `src/modules/channels`: CRUD de canais de venda
- `src/modules/dashboard`: resumo financeiro
- `src/modules/whatsapp`: webhook e processamento de mensagens
- `src/modules/telegram`: bot Telegram (polling)
- `prisma`: schema, migrations e seed

## Configuracao de ambiente

1. Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

2. Preencha todas as variaveis no `.env`.

Variaveis obrigatorias:
- DATABASE_URL
- JWT_SECRET (minimo 32 caracteres)
- JWT_EXPIRES_IN
- JWT_REFRESH_EXPIRES_IN
- WHATSAPP_TOKEN
- WHATSAPP_VERIFY_TOKEN
- WHATSAPP_APP_SECRET
- WHATSAPP_PHONE_ID
- TELEGRAM_BOT_TOKEN
- GEMINI_API_KEY
- PORT (padrao 3001)
- NODE_ENV (development, production, test)

## Rodando com Docker (recomendado)

Sobe PostgreSQL + backend em modo dev:

```bash
docker compose -f docker-compose.dev.yml up --build
```

A API ficara disponivel em:
- http://localhost:3001

## Rodando local (sem Docker)

1. Instale dependencias:

```bash
npm install
```

2. Gere o client do Prisma:

```bash
npm run prisma:generate
```

3. Rode as migrations:

```bash
npm run prisma:migrate
```

4. (Opcional) Popule dados iniciais:

```bash
npm run prisma:seed
```

5. Inicie em desenvolvimento:

```bash
npm run dev
```

## Scripts uteis

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run format
npm run test
npm run test:watch
npm run test:coverage
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

## Endpoints e documentacao

Prefixo global da API:
- /api/v1

Documentacao:
- UI (Scalar): http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json

Health check:
- GET http://localhost:3001/api/v1/health

Webhook WhatsApp:
- GET http://localhost:3001/api/v1/webhook
- POST http://localhost:3001/api/v1/webhook

## Fluxo basico de desenvolvimento

1. Subir banco (Docker) ou garantir Postgres local
2. Configurar `.env`
3. Rodar `npm run prisma:generate`
4. Rodar `npm run prisma:migrate`
5. Rodar `npm run dev`
6. Validar em `/docs`

## Testes

Rodar todos os testes:

```bash
npm run test
```

Com cobertura:

```bash
npm run test:coverage
```

## Observacoes

- O projeto usa guard global de autenticacao. Rotas publicas usam decorator Public.
- O modulo de Telegram remove webhook e roda em polling no startup.
- O webhook do WhatsApp valida assinatura e token de verificacao.

## Licenca

Uso privado (private). Ajuste conforme necessidade do repositorio.
