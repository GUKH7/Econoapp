# Runbook — Verificação operacional da Etapa 1 (Din)

**Objetivo:** reunir evidência de produção sem alterar dados de usuários, segredos ou disponibilidade. Atualizado em 24/10/2026.

## Regras de segurança

- Use acesso **somente leitura** nos diagnósticos iniciais.
- Nunca envie senhas, tokens, `DATABASE_URL`, conteúdo de tabelas de clientes ou dumps para issues/PRs.
- Para registrar evidências, use apenas estado, horário, identificador do serviço e mensagens de erro **sem dados sensíveis**.
- Não execute testes sintéticos usando uma conta real de usuário, nem migrações `dev` em produção.
- Backups só devem ser restaurados em ambiente isolado, com aprovação e identificação do destino.

## A. Render: serviços web

No dashboard do Render, localize os serviços `econoapp-backend`, `econoapp-web` e `econoapp-admin`. Para cada um, confirme:

- [ ] Serviço existe e possui URL/hostname esperado.
- [ ] Status atual, última implantação concluída, commit publicado e timestamp.
- [ ] Plano, região, instâncias, restart loops ou eventos de indisponibilidade.
- [ ] Healthcheck, latência e log recente sem erros críticos.
- [ ] Resposta HTTP de `/health` registrada com código e horário.
- [ ] A PWA consegue acessar a API de modo autenticado, testado via conta **de testes**.
- [ ] A autenticação do painel admin é validada sem compartilhar credenciais.

**Interpretação:** o `/health` atual **não valida o banco**; status 200 só comprova que a rota respondeu.

## B. PostgreSQL e Prisma

No provedor que realmente hospeda a instância:

- [ ] Confirmar status, plano, região e origem de `DATABASE_URL` **sem copiar seu valor**.
- [ ] Confirmar conexão com backend e logs de erros.
- [ ] Registrar último backup, tipo (snapshot/PITR/export), retenção e local de armazenamento.
- [ ] Consultar status da tabela `_prisma_migrations` por canal administrativo autorizado.
- [ ] Confrontar com diretórios em `prisma/migrations`; reportar somente quantidade de migrações aplicadas/pendentes/falhas.
- [ ] Testar restauração em instância temporária segregada, sem acessar dados pessoais fora do escopo autorizado.

**Evitar:** `prisma migrate dev`, `db push` e restauração sobre produção.

## C. GitHub Actions: E2E de WhatsApp

Em **Settings → Secrets and variables → Actions** do repositório:

- [ ] Cadastrar/validar `E2E_USER_PHONE`, `E2E_USER_PASSWORD` e `E2E_WEBHOOK_TOKEN` como secrets — **apenas nomes, nunca valores em PR**.
- [ ] Utilizar usuário exclusivo para E2E, sem lançamentos financeiros reais.
- [ ] Verificar que o segredo de assinatura do webhook corresponde ao ambiente testado.
- [ ] Em **Actions**, verificar status enabled/disabled do workflow `E2E production`.
- [ ] Executar **manualmente**, após preparar usuário e ambiente. Monitorar criação e remoção da transação fictícia.
- [ ] Confirmar que o cleanup completou; se falhar, investigar dados artificiais residuais sem editar dados reais.
- [ ] Só depois restabelecer agendamento diário e confirmar a execução subsequente.
- [ ] Manter `E2E_WHATSAPP_RECIPIENT` desabilitado quando não houver autorização para envio real.

Falha de referência: [run #98](https://github.com/GUKH7/Econoapp/actions/runs/35448970716), ausência de variáveis E2E.

## D. Mensageria e IA

- [ ] Observar conexão do provider WhatsApp, fila de entrada e saída, dead-letter e retries.
- [ ] Revisar taxas de processamento e erros recentes, sem ler/transcrever mensagens reais fora do necessário.
- [ ] Confirmar configurações de Telegram/Gemini por **presença de variável**, não valor.
- [ ] Registrar separadamente integração disponível, funcionalidade testada e dependências ainda não verificadas.

## E. Fechamento

Atualizar as issues [#3](https://github.com/GUKH7/Econoapp/issues/3), [#4](https://github.com/GUKH7/Econoapp/issues/4), [#5](https://github.com/GUKH7/Econoapp/issues/5) e [#6](https://github.com/GUKH7/Econoapp/issues/6) com evidências sanitizadas. Só fechar a etapa quando os critérios de aceite em cada issue forem cumpridos.

**Nota:** esta lista não autoriza alteração de credenciais, deploy, execução de E2E ou restauração de backup sem contexto e controle apropriados.
