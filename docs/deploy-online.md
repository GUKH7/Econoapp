# Deploy online do EconoApp

Objetivo: substituir o LocalTunnel por URLs fixas para backend, web app e banco.

## Arquitetura recomendada

- PostgreSQL gerenciado: Render Postgres, Railway Postgres, Neon ou Supabase.
- Backend NestJS: serviço Docker usando `Dockerfile.prod`.
- Web/PWA: serviço Docker usando `Dockerfile.web`.

Essa separação evita depender do PC local e permite testar pelo celular com URL fixa.

## Backend

Use o `Dockerfile.prod`.

Comandos executados pelo container:

```sh
npx prisma migrate deploy && npm start
```

Healthcheck:

```text
/health
```

Variáveis obrigatórias:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
JWT_SECRET=troque_por_uma_chave_com_mais_de_32_caracteres
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
GEMINI_API_KEY=dev-placeholder
TELEGRAM_BOT_TOKEN=dev-placeholder
PORT=3001
NODE_ENV=production
```

Observação: use valores reais para `GEMINI_API_KEY` e `TELEGRAM_BOT_TOKEN` quando essas integrações forem ativadas em produção.

## Web/PWA

Use o `Dockerfile.web`.

Healthcheck:

```text
/health
```

Variáveis:

```env
WEB_PORT=5173
WEB_API_URL=https://URL_PUBLICA_DO_BACKEND/api/v1
```

Se `WEB_API_URL` não for definida, o web app usa `/api/v1` no mesmo domínio e o `web/server.js` faz proxy para `API_TARGET`.

Proxy opcional:

```env
API_TARGET=https://URL_PUBLICA_DO_BACKEND
```

## Ordem de publicação

1. Criar banco PostgreSQL online.
2. Criar serviço backend usando `Dockerfile.prod`.
3. Configurar `DATABASE_URL` e demais variáveis no backend.
4. Confirmar que `https://URL_BACKEND/health` retorna `{"status":"ok"}`.
5. Criar serviço web usando `Dockerfile.web`.
6. Configurar `WEB_API_URL=https://URL_BACKEND/api/v1`.
7. Abrir URL pública do web app e testar cadastro/login.

## Alternativa com Vercel

O web app pode ser servido como site estático na Vercel, mas ainda precisa de backend e banco fora da Vercel.

Nesse caso, configure `web/config.js` antes do deploy:

```js
window.ECONOAPP_CONFIG = {
  apiUrl: 'https://URL_PUBLICA_DO_BACKEND/api/v1',
};
```

Para evitar editar arquivo manualmente a cada ambiente, prefira o `Dockerfile.web` em Render/Railway, pois ele injeta `WEB_API_URL` por variável de ambiente.
