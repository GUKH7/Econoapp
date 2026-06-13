# E2E de produção e infraestrutura

## Cobertura dos testes

O projeto possui três níveis de teste para a integração do WhatsApp:

1. **Disponibilidade:** consulta a saúde do Render e o status da sessão na API Oracle.
2. **E2E automatizado:** autentica um usuário real, envia uma mensagem ao webhook do Render, percorre as perguntas do chatbot, confirma o lançamento, verifica a transação `WHATSAPP` no banco e a exclui ao final.
3. **E2E de entrada real:** aguarda uma mensagem enviada pelo WhatsApp e comprova o caminho WhatsApp → Oracle → Render → PostgreSQL.

O envio Render → Oracle → WhatsApp também pode ser validado quando
`E2E_WHATSAPP_RECIPIENT` estiver configurado.

## Configuração local

Copie as variáveis de `.env.e2e.example` para um arquivo local não versionado e execute:

```powershell
$env:E2E_WEBHOOK_TOKEN="..."
$env:E2E_USER_PHONE="5511999999999"
$env:E2E_USER_PASSWORD="..."
npm run test:e2e:production
```

Para validar a entrada real, execute:

```powershell
npm run test:e2e:production:live
```

O terminal exibirá uma mensagem única. Envie essa mensagem ao número oficial do EconoApp e conclua as perguntas no WhatsApp. O teste aguardará até quatro minutos, verificará o banco e removerá o lançamento criado.

## GitHub Actions

Cadastre estes secrets no repositório:

- `E2E_WEBHOOK_TOKEN`
- `E2E_USER_PHONE`
- `E2E_USER_PASSWORD`
- `E2E_WHATSAPP_RECIPIENT` (opcional)

O workflow `E2E production` executa diariamente o fluxo automatizado. O envio real de mensagem fica disponível apenas na execução manual.

Use um usuário exclusivo para testes. Ele precisa ter pelo menos uma conta ou carteira cadastrada. Não use a senha de uma conta pessoal.

## Infraestrutura paga

Valores consultados em 13 de junho de 2026:

| Opção | Custo inicial aproximado | Consequência |
| --- | ---: | --- |
| Render atual gratuito | US$ 0 | O backend hiberna após 15 minutos e pode levar cerca de um minuto para iniciar. |
| Render mínimo recomendado | US$ 13/mês | Backend Starter (US$ 7) + PostgreSQL Basic 256 MB (US$ 6). Remove a inicialização lenta e mantém a arquitetura atual. |
| Render com frontend web pago | US$ 20/mês | Soma outro serviço Starter de US$ 7. Evitável se o frontend virar Static Site. |
| Railway Hobby | US$ 5 de consumo mínimo | Cobrança por uso e meta de disponibilidade de 99,9%; exige migração e nova validação operacional. |
| Fly.io | variável por recurso/região | Possui região em São Paulo, mas exige maior operação de máquinas, rede e banco. |

Em uma medição real feita em 13 de junho de 2026, o endpoint `/health` do backend
levou **32,9 segundos** para responder depois de um período de inatividade. A sessão
WhatsApp na Oracle estava com status `conectado`.

O PostgreSQL gratuito do Render possui limite de 30 dias. Como a instância atual
foi criada em 5 de junho de 2026, a atualização ou migração do banco deve ser
concluída antes do início de julho de 2026 para evitar perda de disponibilidade.

Fontes oficiais:

- Render: https://render.com/pricing
- Hibernação gratuita do Render: https://render.com/docs/free
- Railway: https://railway.com/pricing
- Fly.io: https://fly.io/docs/about/pricing/

## Recomendação

O caminho de menor risco é:

1. Migrar apenas `econoapp-backend` para Render Starter.
2. Migrar o PostgreSQL para `Basic-256mb`.
3. Manter o workspace Hobby, sem contratar o workspace Pro de US$ 25.
4. Converter `econoapp-web` para Static Site, removendo o custo e a hibernação do frontend.
5. Manter a Oracle para a sessão do WhatsApp enquanto ela estiver estável.
6. Executar o E2E diário e alertar quando saúde, Oracle, webhook ou banco falharem.

Essa configuração parte de aproximadamente **US$ 13 por mês**, preserva o deploy atual e elimina o principal atraso percebido pelo chatbot.

Prioridade recomendada:

1. Atualizar primeiro o PostgreSQL para `Basic-256mb`.
2. Em seguida, atualizar o backend para `Starter`.
3. Depois, converter o frontend em Static Site.
