# Plano do App Mobile EconoApp

## Objetivo

Criar um app para smartphone integrado ao backend atual do EconoApp e ao chatbot, oferecendo uma experiencia visual e detalhada para acompanhamento financeiro. O chatbot continua sendo o canal rapido de lancamentos por linguagem natural, enquanto o app vira o centro de consulta, analise, edicao e simulacao.

## Perfil de usuario

O produto atual atende principalmente pessoas e pequenos vendedores que registram entradas e saidas pelo Telegram, incluindo vendas por canais como Shopee e Mercado Livre. O app deve preservar essa simplicidade: lancar rapido, entender o saldo, enxergar para onde o dinheiro esta indo e tomar decisoes melhores.

## MVP recomendado

1. Autenticacao
   - Cadastro com nome, telefone, email opcional e senha.
   - Login com telefone ou email e senha.
   - Refresh token transparente.
   - Tela de perfil com edicao basica.

2. Inicio financeiro
   - Saldo do periodo.
   - Total de receitas.
   - Total de gastos.
   - Resultado liquido.
   - Fluxo de caixa por dia.
   - Distribuicao por categoria.
   - Resultado por canal de venda, incluindo valor bruto, liquido e quantidade.

3. Lancamentos
   - Lista paginada com filtros por periodo, tipo, categoria e canal.
   - Cadastro manual de receita ou gasto.
   - Edicao e exclusao de lancamentos.
   - Indicacao da origem do lancamento: manual, Telegram ou audio.

4. Categorias e canais
   - CRUD de categorias com cor.
   - CRUD de canais de venda com taxa percentual.
   - Uso das taxas de canal para calcular valor liquido.

5. Integracao com chatbot
   - Mostrar no app os lancamentos criados via Telegram.
   - Diferenciar visualmente lancamentos feitos por chat/audio/manual.
   - Criar uma area "Chatbot" com status de vinculacao, atalhos de comandos e historico recente de lancamentos importados.

## Telas principais

- Login
- Cadastro
- Home / Dashboard
- Lancamentos
- Novo lancamento
- Detalhe/edicao de lancamento
- Categorias
- Canais de venda
- Simulador de investimentos
- Perfil
- Integracao com chatbot

## Endpoints disponiveis hoje

Base path: `/api/v1`

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `PATCH /auth/me`
- `GET /dashboard`
- `GET /transactions`
- `POST /transactions`
- `PATCH /transactions/:id`
- `DELETE /transactions/:id`
- `GET /categories`
- `POST /categories`
- `PATCH /categories/:id`
- `DELETE /categories/:id`
- `GET /channels`
- `POST /channels`
- `PATCH /channels/:id`
- `DELETE /channels/:id`

Esses endpoints ja sustentam um MVP mobile funcional.

## Lacunas para o backend

1. Simulador de investimentos
   - Criar modulo `investments` ou `simulations`.
   - Endpoint sugerido: `POST /investment-simulations`.
   - Entrada: valor inicial, aporte mensal, prazo, taxa mensal ou anual, tipo de rendimento e inflacao opcional.
   - Saida: total aportado, rendimento bruto, saldo final, serie mensal e comparativos.

2. Metas e orcamentos
   - Criar metas por categoria ou objetivo.
   - Alertar quando gastos se aproximarem do limite.
   - Endpoints sugeridos: `/budgets` e `/goals`.

3. Vínculo formal com chatbot
   - Hoje o usuario tem `telegramId` no banco, mas o app precisa de um fluxo claro para conectar/desconectar Telegram.
   - Endpoint sugerido: `POST /chatbot/link-token` para gerar codigo temporario.
   - O usuario envia o codigo no Telegram e o backend associa `telegramId` ao usuario autenticado.

4. Insights inteligentes
   - Gerar resumos automáticos com IA usando dados do dashboard.
   - Endpoint sugerido: `GET /insights?startDate=&endDate=`.

## Stack mobile sugerida

Recomendacao: Expo + React Native + TypeScript.

Motivos:

- Boa velocidade para MVP Android/iOS.
- Integra bem com APIs REST existentes.
- Facilita testes em smartphone real via Expo Go.
- Permite evoluir para build nativo quando o produto amadurecer.

Bibliotecas provaveis:

- `expo-router` para navegacao.
- `@tanstack/react-query` para cache e estado de servidor.
- `react-hook-form` + `zod` para formularios.
- `expo-secure-store` para tokens.
- `victory-native` ou `react-native-gifted-charts` para graficos.

## Contrato de dados essencial

O app deve consumir os tipos já expostos pelo backend:

- `AuthTokensResponse`
- `UserResponse`
- `DashboardSummaryResponse`
- `TransactionResponse`
- `CategoryResponse`
- `ChannelResponse`

No mobile, esses contratos devem ficar em uma camada `src/api/types.ts`, evitando duplicar regras de negocio no cliente.

## Arquitetura sugerida do app

```text
mobile/
  app/
    (auth)/
      login.tsx
      register.tsx
    (tabs)/
      index.tsx
      transactions.tsx
      simulate.tsx
      settings.tsx
  src/
    api/
      client.ts
      auth.ts
      dashboard.ts
      transactions.ts
      categories.ts
      channels.ts
      types.ts
    components/
    features/
      dashboard/
      transactions/
      categories/
      channels/
      investments/
      chatbot/
    storage/
      tokens.ts
    theme/
```

## Experiencia desejada

O app deve ser mais operacional do que promocional. A primeira tela pos-login deve mostrar o dinheiro de forma clara, com acoes rapidas para adicionar receita/gasto e revisar o que veio do chatbot. O usuario nao deve precisar "aprender o app"; ele deve reconhecer imediatamente saldo, entradas, saidas, categorias e proximas acoes.

## Primeira fase de implementacao

1. Criar monorepo simples com pasta `mobile/`.
2. Subir Expo com TypeScript.
3. Implementar cliente HTTP autenticado.
4. Implementar login/cadastro e persistencia de token.
5. Implementar dashboard consumindo `GET /dashboard`.
6. Implementar lista e criacao de transacoes.
7. Implementar categorias e canais para suportar os formularios.
8. Depois disso, iniciar simulador de investimentos no backend e no app.

