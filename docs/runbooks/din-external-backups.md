# Din — Backup externo sem gasto adicional

**Diretriz do proprietário (24/10/2026): custo adicional ZERO.** Esta PR prepara uma cópia criptografada **no dispositivo já existente do usuário**, sem qualquer bucket, assinatura, nova nuvem, serviço pago, cobrança por excedente, ou cron acionado automaticamente. **Não houve exportação de dados reais.**

## Estado e recursos preservados

- Neon projeto `econoapp`, banco `neondb`, PostgreSQL 18.
- Branch atual `production` (`br-billowing-truth-atturdn9`), branch original `backup-production-original-2026-10-24` (`br-purple-block-at5hdizv`) e snapshot manual `din-snapshot-seguranca-2026-10-24` devem permanecer intactos.
- A janela nativa de recuperação do plano gratuito é de 6 horas; uma cópia fora do Neon protege contra incidentes não cobertos pelo histórico interno.
- Repositório GitHub é **público**: **NUNCA** commitar dump, chave privada, credenciais ou arquivos de backup.
- A branch da PR **não foi mesclada à main**. Render faz auto-deploy da main. Não é necessário merge/deploy para testar localmente com os arquivos desta branch.

## Arquitetura gratuita

| Componente | Solução |
| --- | --- |
| Fonte | pg_dump PostgreSQL 18, via TLS verificado e leitura consistente |
| Criptografia | `age` (ferramenta gratuita e aberta), stream do pg_dump para arquivo já criptografado |
| Destino primário | Pasta protegida no computador do proprietário, **fora do repositório Git** |
| Segunda cópia recomendada | Pendrive ou HD já existente; alternativamente Drive **já disponível** e com espaço gratuito suficiente, sempre arquivo criptografado |
| Retenção inicial | Conservar até 30 cópias diárias ou semanais conforme o uso; **nenhuma exclusão automática**, revisar manualmente após validar restauração |
| Ensaio de restauração | `scripts/verify-external-backup.sh` restaura com Docker PostgreSQL 18 isolado, sem rede e sem porta publicada |
| Agenda | **Manual**, sem serviço externo que possa cobrar ou ativação involuntária |

A **primeira cópia fora do Neon** só estará pronta após executar a exportação real no computador do proprietário. Até então, o código tem testes sintéticos aprovados, mas não constitui backup real.

## Instalação local (sem enviar senhas ao ChatGPT)

Usar computador particular confiável com Bash (Linux ou WSL), Docker/Podman compatível com comando `docker`, `age`, `sha256sum` e espaço livre. Ferramentas e imagens são gratuitas nos cenários pessoais aplicáveis; confirme licenciamento se houver uso empresarial de Docker Desktop. Não utilizar computadores compartilhados, CI público ou Render para guardar a chave privada.

1. Preparar uma pasta local **fora do GitHub** e proteger seu acesso. Para gerar uma chave nova, usar `age-keygen -o din-backup-identity.agekey` em local seguro **fora do repositório**.
2. Guardar a chave privada em local seguro e uma segunda cópia offline. A chave pública pode ser obtida com `age-keygen -y din-backup-identity.agekey`. **Perder a chave privada impede recuperar os backups**.
3. No painel do Render, conferir o destino atual de `DATABASE_URL` sem copiá-la para mensagens; verificar também que é o endpoint Neon correto. Usar credencial de leitura dedicada quando possível. Criar/alterar permissões do Neon não está autorizado nesta etapa.
4. Preparar variáveis de ambiente locais, sem salvar senhas em arquivos versionados:

   - `DIN_BACKUP_PGHOST`: hostname real do Neon, sem `postgresql://`, usuário ou senha.
   - `DIN_BACKUP_EXPECTED_PGHOST`: repetir o hostname aprovado separadamente.
   - `DIN_BACKUP_PGUSER`, `DIN_BACKUP_PGPASSWORD`, `DIN_BACKUP_PGDATABASE`: credencial de backup e banco.
   - `DIN_BACKUP_AGE_RECIPIENT`: chave **pública** `age1...`.
   - `DIN_BACKUP_LOCAL_DIR`: caminho absoluto para pasta segura existente **fora do repositório**, por exemplo `/home/usuario/din-backups` (exemplo apenas).
   - `DIN_BACKUP_LIVE_CONFIRM=BACKUP_REAL_DATA`: exige consentimento para executar sobre o banco real.

5. Executar, localmente e **apenas depois de autorizar a exportação real**: `bash scripts/backup-neon-local.sh`. O script confere o hostname, recusa salvar dentro do repositório, usa TLS e gera `din-production-AAAA...dump.age` e um arquivo `.sha256`.
6. Verificar o arquivo em pasta segura com `sha256sum -c nome-do-arquivo.dump.age.sha256` (dentro da pasta), e recuperar em contêiner temporário com `bash scripts/verify-external-backup.sh /caminho/backup.dump.age /caminho/seguro/chave.agekey`.
7. Conferir contagens agregadas de tabelas, transações, contas e migrations; para a recuperação de produção real, validar também relacionamentos e consistência contábil antes de considerar concluído.
8. **Só depois** copiar o arquivo `.age` já criptografado e o respectivo hash para **segundo destino já disponível sem custo**. Não enviar chave privada junto do arquivo criptografado.

## Limitações e prevenção de custos

- Este PR **removeu a rotina R2/S3 e o workflow de backup programado**. Não há como iniciar uma cobrança de armazenamento a partir dos scripts atuais.
- A exportação manual envolve conexão ao Neon atual e tráfego de dados; seu plano Free tem limites de consumo, então acompanhe a cota existente no painel. Este procedimento não cria recurso pago nem altera o plano.
- Caso não haja espaço livre em nenhum dispositivo existente, **não comprar equipamentos ou serviços**; manter o snapshot e discutir a opção de armazenamento que já possui.
- Backup manual depende de disciplina e pode ficar desatualizado; registrar data da última cópia e repetir depois de movimentações significativas.
- Salvar no próprio computador e em uma segunda cópia local é independente do Neon, mas não tem o mesmo grau de proteção geográfica de um backup em outra região. Se usar Google Drive existente, verificar espaço sem permitir cobrança por excesso.
- A exportação lógica não inclui configuração global de papéis, secrets do Render ou chaves privadas. Essas configurações devem ser documentadas de modo seguro separadamente.
- **Nunca apagar automaticamente backups, branches ou snapshots existentes.**

## Situação de conclusão

- [x] Código de backup local criptografado sem integração paga.
- [x] Testes de bloqueio de execução não autorizada, hostname e saída criptografada preparados.
- [x] Procedimento de restauração isolada com PostgreSQL 18.
- [x] Teste de restauração ponta-a-ponta com dados fictícios automatizado.
- [ ] Exportação **real** feita manualmente em computador confiável após autorização.
- [ ] Verificação e recuperação da cópia real.
- [ ] Segunda cópia feita em armazenamento já existente e gratuito.
- [ ] Definição da frequência e revisão de retenção sem exclusão não autorizada.

**Status: backup gratuito pronto para revisão e uso manual; nenhum backup real externo foi realizado nesta conversa.**
