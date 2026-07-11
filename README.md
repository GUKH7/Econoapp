# EconoApp

EconoApp e uma plataforma de gestao financeira pessoal e empresarial. O projeto combina API NestJS, banco PostgreSQL, assistente com Google Gemini, integracoes com Telegram e WhatsApp, web app PWA e app mobile Expo.

A ideia central e permitir que usuarios registrem receitas, despesas, canais de venda, categorias, contas, cartoes e orcamentos por interfaces simples, incluindo conversas em linguagem natural.

## Funcionalidades

- Registro de transacoes manuais, por Telegram e por WhatsApp.
- Extracao inteligente de dados financeiros com Google Gemini.
- Gestao de categorias, canais de venda e taxas.
- Contas, carteiras, cartoes de credito e escopos pessoal/empresarial.
- Dashboard com resumo financeiro e relatorios.
- Alertas de orcamento e notificacoes agendadas via WhatsApp.
- Web app PWA e app mobile Expo consumindo a mesma API.

## Tecnologias

- Backend: NestJS, TypeScript, Prisma e PostgreSQL.
- IA: Google Gemini.
- Bots: Telegraf para Telegram e Baileys via servico externo para WhatsApp.
- Web: HTML, CSS e JavaScript com servidor/proxy Node.
- Mobile: Expo e React Native.
- Qualidade: Vitest, ESLint e Prettier.
- Deploy: Docker, Docker Compose e Render.

## Estrutura

```text
src/
  common/          filtros, guards, decorators e tipos compartilhados
  config/          banco e variaveis de ambiente
  domain/          regras financeiras puras
  modules/         modulos NestJS da aplicacao
    accounts/      contas e cartoes
    assistant/     assistente e atividade
    auth/          login, JWT, Google e perfil
    budgets/       orcamentos por categoria
    categories/    categorias
    channels/      canais de venda
    dashboard/     resumo financeiro
    health/        healthcheck
    telegram/      bot Telegram
    transactions/  transacoes
    whatsapp/      webhook, envio e alertas WhatsApp
  services/        integracoes externas
  utils/           utilitarios
web/               PWA estatico
mobile/            app Expo/React Native
prisma/            schema, migrations e seed
```

## Ambiente

Crie um `.env` a partir do `.env.example`.

Variaveis essenciais:

```text
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/econoapp?schema=public"
JWT_SECRET="troque_por_uma_chave_com_mais_de_32_caracteres"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
GEMINI_API_KEY="sua_chave_gemini"
TELEGRAM_BOT_TOKEN="seu_token_telegram"
WHATSAPP_BOT_API_URL="http://64.181.189.107:3001/econoapp"
WHATSAPP_WEBHOOK_TOKEN="token_forte_para_webhook"
WHATSAPP_BUDGET_ALERT_TOKEN="token_forte_para_alertas"
PORT=3001
NODE_ENV="development"
CORS_ORIGIN="*"
```

Em producao, nao deixe `CORS_ORIGIN` como `*`. Informe o dominio publico do web app. O webhook do WhatsApp tambem deve ter `WHATSAPP_WEBHOOK_TOKEN` configurado.


## Login com Google

O login com Google depende de `GOOGLE_CLIENT_ID` configurado no backend e no servidor web. Use o Client ID do tipo Web criado no Google Cloud Console.

Em ambiente com backend e web separados, configure o mesmo valor nos dois servicos. O backend tambem aceita varios client IDs separados por virgula, mas o web app usa o primeiro para renderizar o botao.

Se essa variavel estiver vazia, o botao do Google nao aparece no web app e a rota `/auth/google` retorna erro de configuracao.

## Rodar localmente

```bash
npm install
docker compose up -d postgres
npx prisma migrate dev
npx prisma generate
npm run dev
```

A API sobe em:

```text
http://localhost:3001/api/v1
```

A documentacao da API fica em:

```text
http://localhost:3001/docs
```

## Web/PWA

```bash
node web/server.js
```

Acesse:

```text
http://localhost:5173
```

O servidor web faz proxy de `/api/v1/*` para a API configurada em `API_TARGET`.

## Mobile

```bash
cd mobile
npm install
npm run start
```

Para testar em celular fisico, defina `EXPO_PUBLIC_API_URL` com o IP da maquina na rede local, por exemplo:

```text
EXPO_PUBLIC_API_URL=http://192.168.15.12:3001/api/v1
```

## Docker

```bash
docker compose up -d --build
```

O servico `api` aguarda o PostgreSQL ficar saudavel, executa as migrations e inicia o backend.

## Testes e qualidade

```bash
npm run build
npm run test
npm run lint
npm run test:coverage
```

No app mobile:

```bash
cd mobile
npm run typecheck
```

## Comandos do bot Telegram

- `/start` inicia o bot.
- `/saldo` mostra o saldo do mes.
- `/resumo` gera resumo financeiro.
- `/canais` gerencia canais de venda.
- `/configuracoes` abre ajustes de perfil.
- `/ajuda` lista comandos disponiveis.

## Licenca

MIT. Veja o arquivo `LICENSE`.
