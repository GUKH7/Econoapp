# Din — Alertas gratuitos e watchdog (PR #12 em rascunho)

**Estado:** somente branch de proposta. Nenhum merge, deploy, alteração de produção ou mudança financeira autorizados.

## Diagnóstico — 26/10/2026
- PR #8 foi implantado; 4 sondas funcionaram nas duas primeiras execuções do monitor principal.
- O monitor 'Production availability' tem cron 43 */6 * * * UTC, mas somente duas execuções agendadas haviam sido observadas no dia, ambas aprovadas. O GitHub pode atrasar ou descartar execuções programadas.
- A Vigília do Din no ChatGPT está habilitada; notificações push e e-mail estão desativadas. Houve registro de mensagem sobre erro da tarefa, mas a causa específica não está comprovada.
- A primeira menção de teste no PR #12 foi feita pela própria conta GUKH7; não comprova recebimento por e-mail/web. Uma menção via GitHub Actions com autoria de bot é um teste melhor.
- O GitHub direciona notificações de workflows agendados ao usuário que criou ou posteriormente alterou o cron; não assumir que o destino é sempre o proprietário do repositório.
  Fonte: https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs

## Proposta técnica
1. Watchdog avalia histórico do workflow principal em GET GitHub API usando o GITHUB_TOKEN nativo (sem segredos novos).
2. No workflow de produção, se o watchdog detectar falha recente, inatividade ou intervalo acima de 36 horas sem sucesso, o job falha e publica **um comentário no issue existente #5** com menção `@GUKH7`. A etapa de publicação faz um POST somente à API do GitHub (não ao Din ou Neon), condicionado a evento 'schedule' e a um alerta real.
3. Para não gerar mensagens duplicadas, é aplicado um identificador SHA-256 do tipo de ocorrência e links/datas do último erro e sucesso. Antes da publicação, compara o marcador com até 100 comentários recentes do issue #5; se já existir, não repete.
4. Jobs do GitHub Actions usam permissões mínimas: `contents: read`, `actions: read` e `issues: write` apenas no watchdog de produção; nenhum token pessoal ou webhook externo.
5. A simulação em PR #12 cria **apenas uma menção por GitHub Actions bot** no próprio PR, para medir entrega real, com marcador e deduplicação. Restringe explicitamente ao PR #12 da branch interna, e só executa após testes com mocks.
6. Não escreve no GitHub Issues durante simulações de contrato; o único comentário real de teste é no PR #12. Não existe alerta enviado a partir do novo watchdog em produção enquanto o PR não for integrado.
7. O watchdog depende do agendamento do GitHub e pode atrasar; a Vigília do Din é uma camada independente, desde que o usuário habilite e valide push ou e-mail.

## Testes
- Cenários simulados para monitor: normal, falha recente, recuperação, atraso 36h, desativação, execução manual, pendência, timeout/cancelamento, ordem e timestamps.
- Cenários simulados para entregas: destinatário fixo, ausência de segredos, deduplicação, mudança de ocorrência, URL allowlist e conteúdo.
- Nenhum teste lê contas, transações, e-mails pessoais, Neon, Render ou dados financeiros.

## Configuração gratuita pelo proprietário
- GitHub: https://github.com/settings/notifications → System → Actions: On GitHub ou Email, preferencialmente somente falhas; garantir menções e notificações de conversas. Verificar inbox https://github.com/notifications e e-mail.
- ChatGPT: Settings → Notifications → Tasks, habilitar push/e-mail; testar recebimento de um lembrete inofensivo.
- O GitHub Actions usa runners ubuntu-latest em repositório público, sem contratação adicional; manter o repo público e sem runners maiores.
- O watchdog exige `issues:write` no job de produção para comentar; jamais publica saldos, credenciais ou dados do Neon.

## Bloqueios de liberação
- [ ] Confirmar CI do PR e simulação por GitHub Actions bot.
- [ ] Confirmar pelo usuário que a menção do bot apareceu em web/e-mail.
- [ ] Confirmar pelo usuário que o lembrete ChatGPT foi entregue por push/e-mail.
- [ ] Revisar destinatário e evitar excesso de comentários em issue #5.
- [ ] Planejar publicação: a main está associada ao autodeploy dos 3 serviços Render. No merge autorizado usar **explicitamente [skip render] no título/mensagem do commit criado na main**, de acordo com https://render.com/docs/deploys , e conferir nos Events/Deploys dos três que o deploy foi ignorado. Se esta garantia operacional não for aceitável, primeiro apresentar e autorizar uma estratégia alternativa de bloqueio de autodeploy. Não mesclar sem autorização específica.
- [ ] Confirmar R$ 0 nos planos/cotas e sem novos recursos.
- [ ] Verificar primeira execução agendada e monitorar alertas reais posteriormente.

**Limite:** availability /health/ready não prova backup ou integridade de dados financeiros.

## Homologação de notificações e evidências em 26/10/2026

- A menção original no PR #12 era de autoria GUKH7; **não era um teste independente de entrega**.
- Foi criado smoke automatizado do GitHub Actions com menção a @GUKH7, publicado uma única vez em https://github.com/GUKH7/Econoapp/pull/12#issuecomment-6428290916 pela conta github-actions[bot]. O workflow de testes passou: https://github.com/GUKH7/Econoapp/actions/runs/40408547005. Ainda falta o proprietário confirmar entrega em sua caixa do GitHub/e-mail.
- O primeiro smoke falhou com HTTP 403 ao comentar um PR usando apenas issues:write. Ajustou-se APENAS o job de smoke com pull-requests:write e issues:write. **O watchdog de produção só utiliza issues:write para comentar na issue #5**, que é uma issue regular; a entrega real desta rota ainda não foi demonstrada.
- Há evidência de e-mail de falha de workflow PR chegando ao Gmail conectado; isso não confirma entrega de notificações de agendamentos nem da menção pelo bot.
- A tarefa pontual 'Teste de alerta Din' do ChatGPT concluiu a execução e produziu a mensagem prevista. O sistema registra delivery_status unknown, portanto a notificação push/e-mail segue **não comprovada**. A tarefa pontual ficou desativada após execução, sem afetar a Vigília diária.
- GitHub Actions nativo para runs schedule pode notificar o criador/último editor do cron; o comentário @GUKH7 no issue #5 usa um caminho de menção independente desse ator. O recebimento depende das preferências do usuário, e deve ser testado após configuração.
- Não adicionar token pessoal, login externo, webhook ou serviço pago. Não há aprovação de merge/deploy/rollback.

## Critérios restantes para GO (ainda NÃO atendidos)

- [ ] Usuário confirma a menção do bot no inbox GitHub ou por e-mail (recebimento real).
- [ ] Usuário confirma push/e-mail da tarefa ChatGPT ou habilita o canal e testa de novo.
- [ ] Verificar e autorizar separadamente uma demonstração real de comentário na **issue #5** pelo job programado; até então só existe a simulação segura no PR.
- [ ] CI do commit final do PR #12 verde, nenhum alerta falso em produção.
- [ ] Autorizar explicitamente estratégia de impedir/coordenar autodeploy Render no merge; não integrar apenas porque os testes passaram.

### Segurança da versão final do PR

- O job de smoke (que precisava de issues:write + pull-requests:write para comentar em PR) foi REMOVIDO após o sucesso. A versão final mantém somente o job watchdog para schedule/manual, com actions:read, contents:read e issues:write; a POST à issue #5 só ocorre em alertas de schedule reais, se futuramente aprovado.
- A frase [skip render] não é equivalente a [skip ci]. Não acrescentar [skip ci] pois isso impediria o CI desejado.
- Autodeploy da main ainda está em On Commit nos três serviços; só o commit especificamente marcado será ignorado. Validar eventos de skip com as versões live intactas antes de declarar ativação concluída.
