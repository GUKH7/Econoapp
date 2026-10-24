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
