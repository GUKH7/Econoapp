# Din — Backups externos criptografados (Neon → storage independente)

**24/10/2026. Estado: preparado, DESATIVADO até autorização.** Nenhum dado real foi exportado do Neon durante a criação deste PR.

## Situação do Din

- Projeto Neon: econoapp / empty-union-65559918, PostgreSQL 18, banco neondb.
- Branch default atual: production (br-billowing-truth-atturdn9).
- Branch original preservada: backup-production-original-2026-10-24 (br-purple-block-at5hdizv).
- Snapshot manual existente e preservado: din-snapshot-seguranca-2026-10-24.
- Janela histórica do plano Free: 6 horas. O snapshot depende do Neon, então é necessária cópia off-provider.
- O Render tem auto-deploy pela main. Mesclar este PR, embora não altere código de negócio, pode acionar um deploy; revisar antes do merge.

## Arquitetura proposta

| Controle | Estratégia |
| --- | --- |
| Exportação | pg_dump PostgreSQL 18, formato custom comprimido, schema + dados, apenas leitura e TLS verificado |
| Criptografia | age: somente chave pública no CI; chave privada exclusivamente offline |
| Destino | Bucket privado S3 compatível, preferencialmente Cloudflare R2 Standard, fora do Neon |
| Execução | Diária 05:37 UTC, DESATIVADA até a variável DIN_BACKUP_ENABLED ser explicitamente true |
| Retenção | Proposta: 30 dias de cópias diárias, em lifecycle no bucket (não aplicada ainda) |
| Verificação | Tamanho do objeto via HeadObject, SHA-256 do ciphertext gravado no metadata |
| Restauração | age decryption + pg_restore para container PostgreSQL 18 local isolado, sem rede nem volumes persistentes |

O script de backup não executa SQL de escrita, não altera branches Neon, não publica plaintext em disco, não salva dump em logs/commits/artifacts e nunca exclui backups anteriores. Chaves dos objetos incluem data UTC e ID de execução para reduzir risco de sobrescrita. A identidade privada age deve permanecer fora do GitHub, Render e Neon.

**Limitação:** HeadObject e hash de ciphertext não demonstram restauração bem-sucedida. O primeiro backup só deve ser declarado recuperável após restaurar o arquivo criptografado de verdade em máquina confiável e comparar os dados. pg_dump lógico não inclui roles globais ou configurações externas do PostgreSQL; documentar essas informações separadamente.

## Custos e aprovações pendentes

Cloudflare R2 Standard oferece franquia gratuita publicada de 10 GB-mês, 1 milhão de operações Classe A e 10 milhões Classe B mensais. Excessos podem ser cobrados e o cadastro pode exigir forma de pagamento. Fonte: https://developers.cloudflare.com/r2/pricing/.

**Não criamos conta, bucket, token, job ativo ou contrato.** Solicitar aprovação explícita para: armazenamento de dados financeiros fora do Neon, custos potenciais, credenciais de acesso e política de expiração. R2 não oferece S3 Object Lock; usar credenciais do backup sem permissão de exclusão e considerar outra cópia independente offline. A lifecycle de 30 dias causa exclusões futuras e somente deve ser ativada após consentimento específico e primeiro restore aprovado.

Backup diário implica RPO de até 24 horas, não zero; RTO depende do teste de restauração e deve ser medido. GitHub Actions em repositórios públicos pode perder schedule por inatividade; não depender apenas dele para alertas.

## Preparação (ainda não realizada)

1. Aprovar o provedor e criar um bucket privado sem acesso público, preferencialmente em uma conta externa independente.
2. Criar credenciais de escopo mínimo para PutObject, HeadObject e opcionalmente ListBucket no prefixo din/production/. NÃO conceder DeleteObject nem gerenciamento do bucket.
3. Gerar uma chave de recuperação em máquina pessoal confiável usando o comando: age-keygen -o din-backup-identity.agekey. Guardar a chave privada em duas cópias offline protegidas e nunca compartilhar. A chave pública começa com age1 e é a única parte usada pelo CI.
4. Confirmar localmente no Render qual é o host de DATABASE_URL; NÃO expor a URL, usuário ou senha.
5. Recomenda-se criar credencial separada, somente leitura para pg_dump, com permissões de schema e dados. Essa alteração de permissões requer revisão e aprovação.
6. Configurar o GitHub Environment chamado din-external-backup, com regras de aprovação/restrição de branch quando disponível.

### Secrets do GitHub Actions

- DIN_BACKUP_PGHOST — hostname do endpoint Neon (sem URI ou senha).
- DIN_BACKUP_EXPECTED_PGHOST — hostname validado independentemente que a rotina usa como proteção contra banco errado.
- DIN_BACKUP_PGUSER, DIN_BACKUP_PGPASSWORD, DIN_BACKUP_PGDATABASE — usuário, senha e nome do banco.
- DIN_BACKUP_STORAGE_ACCESS_KEY_ID e DIN_BACKUP_STORAGE_SECRET_ACCESS_KEY — chave restrita do bucket.

### Variables do GitHub Actions

- DIN_BACKUP_AGE_RECIPIENT — apenas chave PÚBLICA age1...
- DIN_BACKUP_S3_ENDPOINT — endpoint HTTPS da conta R2/S3.
- DIN_BACKUP_S3_BUCKET — nome do bucket privado.
- DIN_BACKUP_ENABLED — manter INEXISTENTE ou false. Depois da aprovação e testes, definir true.

## Primeiro ensaio, somente depois da autorização

1. Revisar o PR e executar os testes apenas com dados fictícios: bash -n scripts/*.sh e bash scripts/test-external-backup.sh.
2. Confirmar por escrito storage, custo permitido, quem guarda a chave offline, credenciais e permissão para exportar o banco.
3. Planejar merge/lançamento devido ao auto-deploy no Render. Só o merge na main habilita execução manual do workflow.
4. Configurar Secrets/Variables sem expor valores. Ativar DIN_BACKUP_ENABLED=true SOMENTE após aprovação.
5. Acionar workflow_dispatch com o texto BACKUP_REAL_DATA para permitir a primeira exportação real.
6. Verificar objeto .dump.age no bucket privado e o metadata SHA-256 registrado. Não registrar conteúdo financeiro.
7. Baixar o objeto criptografado para máquina local confiável e testar recuperação com:
   bash scripts/verify-external-backup.sh /caminho/seguro/din.dump.age /caminho/seguro/din-backup-identity.agekey
8. O script de restauração usa container PostgreSQL 18 sem rede, descriptografa por stream, executa pg_restore --exit-on-error e imprime apenas contagem de tabelas, migrations, contas e transações. Remove o container no final. Não rodar na máquina de produção ou em sistema compartilhado.
9. Após verificar o primeiro restore, aprovar separadamente cron automático, lifecycle de 30 dias e alertas sobre ausência de backup por 26 horas. A retenção é aplicada pelo provedor, não por instruções de exclusão neste repositório.

## Critérios de aceite

- [x] Script de exportação, criptografia e upload off-provider preparado.
- [x] Bloqueio de execução real por confirmação e configuração.
- [x] Testes offline com dados fictícios e validação de host implementados.
- [x] Script para ensaio de restauração local e isolado preparado.
- [ ] Destino externo e risco de custos aprovados.
- [ ] Bucket e permissões configurados.
- [ ] Chave pública de criptografia configurada e privada preservada offline.
- [ ] Primeiro backup real criado fora do Neon.
- [ ] Primeira restauração real validada.
- [ ] Retenção e monitoramento aprovados e verificados.

**Enquanto os últimos itens estiverem pendentes, NÃO afirmar que há backup externo real ou restauração externa testada.**
