# Din — Alertas gratuitos e watchdog (proposta sem deploy)

Inspeção em 26/10/2026. A rotina de produção não foi alterada.

## Evidências
- PR #8 integrado à main, commit 594b26c565d4966785274b933d983a782355cc8b.
- Production availability: cron 43 */6 * * * (UTC); 4 verificações esperadas por dia.
- Até a inspeção de 26/10: somente 2 execuções agendadas, às 05:17Z e 13:34Z. Ambas passaram nos 4 healthchecks.
- GitHub admite atrasos e descarte de alguns agendamentos sob carga e desativação automática em repositórios públicos inativos por 60 dias: https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
- A automação independente Vigília do Din está habilitada e registrou uma execução, mas notificações push e e-mail estão desativadas. Uma mensagem anterior da tarefa informou erro, mas a causa específica não foi disponibilizada.

## Solução proposta
- Novo workflow Production availability watchdog (zero new cost), executado duas vezes ao dia, às 04:17 UTC e 16:17 UTC, deslocado do cron principal.
- Acesso somente GET à API GitHub, usando GITHUB_TOKEN efêmero com permissões mínimas (actions: read e contents: read).
- Detecta workflow inativo, falta de sucesso agendado há mais de 36h, execução agendada mais recente concluída com erro, cancelamento ou timeout.
- Execuções manuais não substituem agendamentos na contagem.
- Inclui contagem de runs das últimas 24h e links somente para metadados públicos do Actions.
- Não acessa Render, Neon, saldos, transações, segredos, nem faz POST, SQL, deploy, rollback ou mudanças de infraestrutura.
- Enquanto a branch estiver em PR draft, são executados APENAS os testes com dados fictícios. O schedule do watchdog não fica ativo antes do merge na main.

## Como receber avisos sem gastos
1. GitHub: em https://github.com/settings/notifications, seção System > Actions, escolher Email ou On GitHub e, se disponível, Only notify for failed workflows. A notificação de workflows agendados é normalmente entregue ao usuário que criou ou alterou o cron; confirmar que o destinatário correto recebe. Documentação: https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs
2. ChatGPT: em Configurações > Notificações, habilitar push ou e-mail para tarefas e testar a recepção com um lembrete inofensivo. Estar ativa não é prova de entrega.
3. Não foi configurada criação automática de Issues, webhooks ou novas integrações com terceiros.

## Testes simulados
- Sucesso recente, falha posterior, recuperação, último sucesso há mais de 36 horas, apenas execuções manuais, workflow desativado, corrida pendente, cancelamento, timeout, resultados fora de ordem e timestamp futuro.
- A PR aciona node --test local somente com fixtures; não consulta a API real e não envia dados.

## Restrições
- Projeto público e runners padrão do GitHub Actions não exigem nova contratação. Confirmar novamente se regras de cobrança mudarem.
- Watchdog depende também dos schedules do GitHub e pode atrasar. A Vigília do ChatGPT deve permanecer como verificação independente, mediante entrega real de notificações.
- O monitor reporta saúde das verificações, NÃO prova disponibilidade contínua, recuperação de desastre ou integridade financeira.
- Como Render faz deploy automático de main nos três serviços, o merge do PR draft não deve ocorrer sem autorização específica e plano de controle de deploy.

## Situação
- [x] Código e testes locais preparados.
- [ ] CI da PR aprovado.
- [ ] Alertas GitHub e ChatGPT configurados e testados pelo proprietário.
- [ ] Aprovação específica para merge/deploy e primeira execução agendada.
