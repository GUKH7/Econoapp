# Deploy online do EconoApp

Objetivo: substituir o LocalTunnel por URLs fixas para backend, web app e banco.

## Arquitetura recomendada

- PostgreSQL gerenciado.
- Backend NestJS em container Docker usando `Dockerfile.prod`.
- Web/PWA em container Docker usando `Dockerfile.web`.

Essa separacao evita depender do PC local e permite testar pelo celular com URL fixa.

## Render Blueprint

O arquivo `render.yaml` na raiz do repositorio cria:

- `econoapp-postgres`: banco PostgreSQL.
- `econoapp-backend`: API usando `Dockerfile.prod`.
- `econoapp-web`: PWA usando `Dockerfile.web`.

Todos os recursos estao configurados com `plan: free` no `render.yaml`. Antes de confirmar o Blueprint, revise no painel do Render se backend, web e banco aparecem como Free.

No painel do Render, crie um novo Blueprint apontando para o repo:

```text
https://github.com/GUKH7/Econoapp
```

O Render procura `render.yaml` na raiz do repositorio por padrao.

## Backend

Use o `Dockerfile.prod`.

Comando executado pelo container:

```sh
npx prisma migrate deploy && npm start
```

Healthcheck:

```text
/health
```

Variaveis principais:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
JWT_SECRET=gerado-pelo-render
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
GEMINI_API_KEY=dev-placeholder
TELEGRAM_BOT_TOKEN=dev-placeholder
PORT=3001
NODE_ENV=production
```

`DATABASE_URL` vem automaticamente do banco no Blueprint. `GEMINI_API_KEY` e `TELEGRAM_BOT_TOKEN` ficam marcadas como `sync: false`, entao o Render pede os valores no painel. Enquanto essas integracoes nao forem usadas, pode preencher com `dev-placeholder`.

## Web/PWA

Use o `Dockerfile.web`.

Healthcheck:

```text
/health
```

Variaveis:

```env
WEB_PORT=5173
WEB_API_URL=https://econoapp-backend.onrender.com/api/v1
API_TARGET=https://econoapp-backend.onrender.com
```

Se o Render gerar outro dominio para o backend, ajuste `WEB_API_URL` e `API_TARGET` no servico `econoapp-web`.

## Ordem de publicacao

1. Criar Blueprint no Render usando o repo `GUKH7/Econoapp`.
2. Confirmar que os tres recursos estao em `Free`.
3. Preencher os segredos solicitados.
4. Aguardar o deploy do backend e confirmar `/health`.
5. Ajustar `WEB_API_URL` se o dominio do backend for diferente.
6. Abrir a URL publica do web app e testar cadastro/login.

## Alternativa com Vercel

O web app pode ser servido como site estatico na Vercel, mas ainda precisa de backend e banco fora da Vercel.

Nesse caso, configure `web/config.js` antes do deploy:

```js
window.ECONOAPP_CONFIG = {
  apiUrl: 'https://URL_PUBLICA_DO_BACKEND/api/v1',
};
```

Para evitar editar arquivo manualmente a cada ambiente, o deploy Docker do `econoapp-web` permite injetar `WEB_API_URL` por variavel de ambiente.
