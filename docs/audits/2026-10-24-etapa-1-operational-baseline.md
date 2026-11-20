# Din — auditoria operacional (Etapa 1)

> Levantamento em **24/10/2026**, com observação de código no GitHub e logs de Actions. **Não é uma certificação de produção saudável.** Nenhum segredo, dado de usuário ou valor de variável sensível é reproduzido aqui.

## 1. Escopo e limitações

- Repositório: [GUKH7/Econoapp](https://github.com/GUKH7/Econoapp), branch `main`, commit `7b4e3ebe3cc087c984313b9360e94c2f18f665b0` (21/07/2026).
- Foram revisados: `render.yaml`, `Dockerfile.prod`, `docker-compose.yml`, `prisma/schema.prisma`, diretório `prisma/migrations`, `src/modules/health`, workflow `.github/workflows/e2e-production.yml`, script `scripts/e2e-whatsapp-production.mjs`, documentação operacional e histórico de GitHub Actions.
- A conexão **Render** ainda não está autorizada neste atendimento; não houve acesso autenticado a deploys, logs, variáveis, banco nem snapshots.
- Tentativas de consulta pública a `/health` dos três serviços foram inconclusivas por restrição de rede das ferramentas. **Inconclusivo não significa serviço indisponível.**
- Não foram executados E2E com conta real, migrations, ações destrutivas ou alterações de configuração de produção.

## 2. Inventário de arquitetura observado no repositório

| Componente | Configurado em | Confirmado no código | Estado operacional |
| --- | --- | --- | --- |
| API NestJS | Render `econoapp-backend` | sim, Docker / Prisma / PostgreSQL | não verificado |
| PWA Node | Render `econoapp-web` | sim, com proxy/API | não verificado |
| Painel admin | Render `econoapp-admin` | sim, com proxy/API | não verificado |
| PostgreSQL | `DATABASE_URL` no backend | sim, 24 modelos Prisma e migrations | instância, plano, integridade e backup não verificados |
| Provider WhatsApp | integração externa configurada | sim, fila/inbox/outbox e webhook | status, TLS e fila não verificados |
| Telegram / Gemini | módulos presentes | sim | credenciais e disponibilidade não verificadas |
| GitHub Actions | `e2e-production.yml` | sim | últimas execuções com falha |

O `render.yaml` versionado define os três web services, porém **não define um serviço PostgreSQL**. O documento `docs/deploy-online.md` cita banco no Blueprint: há divergência entre documento histórico e configuração atual. Não inferir que o banco foi removido ou perdido.

## 3. Evidências e classificação de riscos

| Prioridade | Achado | Evidência | Risco / consequência |
| --- | --- | --- | --- |
| **P0** | Banco e estratégia de restauração não verificados | `DATABASE_URL` externamente gerido; [doc histórico](../e2e-and-infrastructure.md) aponta expiração de instância gratuita em 2026 | risco operacional **não quantificado** sobre disponibilidade e recuperação |
| **P0** | E2E de produção falhando antes dos checks | [run #98](https://github.com/GUKH7/Econoapp/actions/runs/35448970716) falha em `E2E_USER_PHONE`; demais variáveis essenciais do job vazias | ausência de sinal confiável do WhatsApp em produção |
| **P1** | Agendamento sem runs novos após 19/09/2026 | últimas dez execuções recuperadas com `failure`; `main` parada desde julho | monitoramento pode estar desabilitado/paralisado |
| **P1** | `/health` superficial | [health.controller.ts](../../src/modules/health/health.controller.ts) retorna apenas `ok`/timestamp | falso senso de prontidão quando o DB falhar |
| **P1** | Docs de deploy desatualizadas | `render.yaml` atual vs. `docs/deploy-online.md` | manutenções com informação incorreta |
| **P1** | Identificadores administrativos versionados | configuração pública `render.yaml` | excesso de exposição; tratar na etapa de hardening |
| **P1** | `main` sem proteção e CI de PR | configuração de branch + único workflow E2E | risco de mudanças sem validação; execução detalhada na Etapa 2 |

> A falta de runs agendados pode decorrer de desativação automática por 60 dias de inatividade em repositórios públicos, conforme [GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows). É **hipótese**, não diagnóstico confirmado do estado do workflow.

### Cuidados sobre o E2E existente

O script `scripts/e2e-whatsapp-production.mjs` autentica uma conta de teste, cria transação e tenta apagá-la no `finally`. Se o cleanup falhar, dados residuais podem permanecer. Configurar uma conta **isolada para testes**, sem dados pessoais reais, antes de rodar novamente. Manter envio de WhatsApp real apenas sob acionamento explícito.

## 4. Checklist externo pendente (somente leitura/validação)

1. **Render:** identificar último deploy, status, plano, região, logs recentes de cada serviço e health checks. Não copiar valores de secrets para GitHub.
2. **Banco:** identificar provedor e instância em uso, confrontar migrations aplicadas e pendentes, consultar saúde/conexões/erros.
3. **Backup:** comprovar última cópia válida, prazo de retenção e teste de restauração em ambiente **isolado**; nunca restaurar sobre produção para validar.
4. **GitHub Actions:** verificar se o workflow E2E está habilitado. Configurar secrets com dados de conta de testes exclusiva e validar manualmente antes de retomar agenda.
5. **Mensageria:** verificar sessão/filas/retries/erros e transporte TLS do provider; não executar envios em massa nem testes invasivos.
6. **Domínios/integrações:** confirmar que PWA e admin alcançam API e que autenticação e CORS funcionam sem capturar credenciais.

Para o procedimento detalhado, ver [runbook da Etapa 1](../runbooks/etapa-1-verificacao-operacional.md).

## 5. Tarefas abertas

- **[#3](https://github.com/GUKH7/Econoapp/issues/3):** banco de produção e backups (**P0**).
- **[#4](https://github.com/GUKH7/Econoapp/issues/4):** E2E do WhatsApp e agendamento (**P0**).
- **[#5](https://github.com/GUKH7/Econoapp/issues/5):** serviços Render e health checks (**P1**).
- **[#6](https://github.com/GUKH7/Econoapp/issues/6):** documentação e inventário (**P1**).

## 6. Critério para fechar Etapa 1

- [ ] Serviços de produção avaliados com dados do Render.
- [ ] Banco real identificado e migrations conciliadas.
- [ ] Backup e restauração testados de forma segura.
- [ ] E2E saudável usando conta de teste dedicada e cleanup verificado.
- [ ] Causa da interrupção do agendamento identificada.
- [x] Riscos confirmados e desconhecidos separados.
- [x] Backlog inicial rastreável no GitHub.
- [x] Nenhuma alteração direta na `main` ou produção durante a auditoria.

**Status: Etapa 1 em andamento.** Bloqueadores restantes dependem do ambiente conectado, configurações confidenciais e testes autorizados.
