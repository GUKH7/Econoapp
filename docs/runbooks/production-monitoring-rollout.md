# Monitoramento e seguranca de dados — ativacao segura

Atualizado em 24/10/2026.

## O que este PR muda

- `GET /health` continua sendo **liveness** para o Render, sem depender de PostgreSQL.
- `GET /health/ready` executa apenas `SELECT 1` no PostgreSQL e devolve `200 {"status":"ok"}` ou `503 {"status":"unavailable"}`; sem consultas a dados financeiros, tabelas de clientes ou secrets.
- O workflow `Production availability` agenda checagens read-only **4 vezes por dia** em backend/liveness, backend/database-readiness, web e admin, sem contas, tokens, webhooks ou escrita no banco. O script usa HTTPS, duas tentativas e timeouts adequados para cold starts.
- `E2E WhatsApp` passa a exigir **acionamento manual** e valida os nomes das variaveis de teste antes de operar. Ele pode criar e excluir transacoes: nunca o rodar com conta pessoal.
- `Code validation` adiciona lint, build, testes e sintaxe de scripts em PR/push para `main`.

## Rollout

1. Revisar o PR e aguardar todos os checks de validação ficarem verdes.
2. Verificar no **Render** o banco real, últimos backups e estado dos três serviços. Em especial, certificar-se de que o backend atual tem banco íntegro antes do deploy.
3. Fazer deploy da nova versão em ambiente isolado e verificar `/health` e `/health/ready`. Depois ativar em produção por release controlado.
4. Após o deploy, executar manualmente **Production availability** no GitHub Actions, verificando 4 sinais de sucesso, e confirmar o próximo agendamento.
5. No GitHub, conferir que o workflow novo está **enabled**. Se o GitHub desabilitou cron por inatividade, reabilitar usando a interface Actions; reativar nunca exige segredos de E2E.
6. Configurar notificações sobre falhas de Actions, além de um monitor externo independente para não depender exclusivamente dos cron jobs do GitHub.
7. Somente depois de provisionar conta **isolada**, preencher `E2E_USER_PHONE`, `E2E_USER_PASSWORD` e `E2E_WEBHOOK_TOKEN` em Secrets e rodar manualmente o E2E. Confirmar limpeza e ausência de dados residuais.

## O que nao esta comprovado por healthcheck

`SELECT 1` atesta somente que a aplicacao consegue consultar o banco. **Nao demonstra**:
- consistência das transações, valores financeiros, saldo e relacionamentos;
- aplicação completa de migrations;
- backups, retenção ou restauração bem-sucedida;
- criptografia em repouso e políticas de acesso ao banco;
- disponibilidade do WhatsApp/Telegram/Gemini;
- se o serviço Render está com os recursos e escalonamento corretos.

Para confirmar a proteção dos dados financeiros, completar as issues [#3](https://github.com/GUKH7/Econoapp/issues/3) e [#5](https://github.com/GUKH7/Econoapp/issues/5) **no provedor de produção**.

## Alertas e limitação de cron

GitHub pode desabilitar agendamentos de repositórios públicos sem atividade por 60 dias. Por isso GitHub Actions é um **sinal secundário**, não um monitor de uptime único. Recomenda-se configurar um provedor de uptime independente com alerta por e-mail/telefone, sob as credenciais do responsável, e verificar manualmente o histórico de execução. O E2E completo precisa permanecer distinto das sondagens read-only.

## Critérios de aceite

- [ ] PR validado e revisto;
- [ ] `/health/ready` retorna 200 com banco disponível e 503 sem banco em ambiente de teste;
- [ ] PR liberado em produção com rollback pronto;
- [ ] `Production availability` tem execução manual e agendada verdes;
- [ ] Monitor externo independente habilitado e alertas testados;
- [ ] Instância real de PostgreSQL, backups e restauração de produção verificados;
- [ ] E2E real, quando autorizado, executa e limpa lançamento de teste isolado.

**Sem esses itens, classificar a etapa como parcial — nunca como dados financeiros comprovadamente seguros.**

## Revisao antes da ativacao — 24/10/2026 (sem custos adicionais)

**Escopo desta revisao: preparacao, nao publicacao.** O PR continua draft, sem merge e sem deploy.

### Fatos confirmados por acesso autenticado

- Render workspace `My Workspace` confirmou os tres servicos em plano Free, branch `main`, `autoDeploy: yes`, `autoDeployTrigger: commit`, healthCheckPath `/health`.
- Os tres ultimos deploys live continuam no SHA `7b4e3ebe3cc087c984313b9360e94c2f18f665b0`, de 21/07/2026. Metricas de request, CPU e memoria vazias; eventos e logs de erro recentes vazios **nao demonstram disponibilidade**.
- URL das sondas e contrato JSON: web/server.js e admin-web/server.js servem `GET /health` com `200 {"status":"ok"}`; Nest controller backend possui liveness, e o PR inclui readiness do Neon em `GET /health/ready`.
- Projeto Neon `econoapp` (`empty-union-65559918`), branch principal atual `production` (`br-billowing-truth-atturdn9`), endpoint associado `ep-morning-mud-at9hnvdo`, branch original preservada `br-purple-block-at5hdizv` com outro endpoint e snapshot manual `din-snapshot-seguranca-2026-10-24`. Nenhum recurso desses deve ser modificado no rollout.
- Consulta SQL read-only realizada na branch production com sucesso: 1 usuario, 3 contas financeiras, 7 transacoes e zero migrations incompletas. Os **25 nomes** em `_prisma_migrations` coincidem com as **25 pastas** em `prisma/migrations` na `main`.
- Code validation do PR #8 passou em lint, build e testes no GitHub Actions run `40107634174`. Teste adicional foi incluido para web/admin `/health` local e quatro probes simulados.
- Os enderecos diretos onrender.com nao foram alcancaveis a partir das ferramentas desta conversa (resolucao de host bloqueada); isto **nao permite afirmar indisponibilidade**. O novo job `current-production-preflight` roda GETs somente leitura a partir da infraestrutura do GitHub e separa esse sinal das consultas diretas.
- O estado health de web/admin nao consulta DB; o readiness do backend `SELECT 1` so informa conectividade, nao integridade financeira, migrations, backup ou permissao.
- Apesar de `/health` do backend nao consultar DB, o `PrismaService.onModuleInit()` **conecta ao Neon no startup**. Se o banco nao estiver disponivel durante o boot, a API pode nem iniciar; portanto `/health` nao e um liveness totalmente independente do DB durante inicializacao.

### Gate de seguranca (bloqueador de publicacao)

`Dockerfile.prod` executa `npm run prisma:deploy && npm start` sempre que o backend inicia. Embora nenhuma migration pendente tenha sido encontrada na consulta atual, **um novo deploy pode conectar e reexecutar checagens/migrations** no banco; por isso a etapa exige autorizacao de publicacao separada do responsavel. O merge em `main` aciona deploy automatico **nos tres servicos**. Render Free nao oferece ambiente paralelo pago sem custos: nao criar instancia extra, branch persistente paga nem ativar recursos pagos.

### Plano de ativacao controlada, pendente de aprovacao expressa

1. Conferir CI do PR #8 **na revisao mais recente**, incluindo testes unitarios e mocks, e a preflight HTTP somente leitura do GitHub Actions nos 3 endpoints existentes. Qualquer falha, HTTP inesperado ou sinal DNS inconclusivo e **STOP** ate investigar.
2. Confirmar na interface do Render, sem revelar `DATABASE_URL`, que o hostname usado pelo backend e `ep-morning-mud-at9hnvdo.c-9.us-east-1.aws.neon.tech` (ou o endpoint oficialmente validado para production).
3. Reconfirmar na mesma janela que nao ha migrations pendentes, novas escritas divergentes entre branches nem eventos criticos no Neon; nao restaurar banco/branch.
4. Pedir ao usuario **autorizacao explicita para realizar merge/deploy de producao**, alertando para a possibilidade de breve indisponibilidade/reinicio e para `prisma migrate deploy` no entrypoint.
5. Somente apos autorizacao, avaliar como coordenar deploy dos tres servicos e manter rollback do commit `7b4e3ebe...` pronto no Render. Nao alterar segredos, banco ou schema. Interromper a ativacao se surgir risco relevante ou erro.
6. Confirmar nos tres servicos o novo SHA implantado e seus estados, e conferir `GET /health` nos tres + `GET /health/ready` no backend. Readiness 503 deve disparar investigacao antes de novas acoes.
7. Executar manualmente `Production availability` no GitHub Actions, com quatro respostas 200 e payload `status: ok`; depois verificar se cron de 6 em 6 horas executa realmente. Somente o cron no GitHub **nao garante** monitoramento, pois pode ser desabilitado em repositorios publicos inativos.
8. Validar alertas sem costo adicional, inspecionar falhas por 24 horas, notificar se cron parar, e manter E2E que cria/exclui transacoes **exclusivamente manual**.

**Plano de contingencia:** ao detectar degradacao significativa, **parar o rollout**, preservar Neon e logs, e solicitar aprovacao do responsavel para eventual rollback no Render; rollback de imagem nao desfaz migracoes. Nao acionar mutacoes financeiras para testar a disponibilidade.

**Restricao de custos:** nenhum novo servico contratado; Render e Neon existentes em plano Free; os GETs podem acordar instancias e consumir parte da cota gratuita atual. Nao alterar plano nem solicitar cartao. Status do monitor em producao continua **PENDENTE** ate o aceite acima.
