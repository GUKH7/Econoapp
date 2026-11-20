#!/usr/bin/env bash
# Zero-new-cost mode: read-only pg_dump streamed into age encryption on a trusted local computer.
# No cloud bucket, paid resource, schedule, or deletion. Never run in shared runners.
set -Eeuo pipefail
umask 077
fail() { printf 'Backup local cancelado: %s\n' "$1" >&2; exit 1; }
need() { local variable="$1"; [[ -n "${!variable:-}" ]] || fail "Configuracao ausente: $variable"; }

for program in docker age sha256sum realpath mktemp mv date; do
  command -v "$program" >/dev/null 2>&1 || fail "Ferramenta gratuita ausente: $program"
done
[[ "${DIN_BACKUP_LIVE_CONFIRM:-}" == 'BACKUP_REAL_DATA' ]] || fail 'Exige autorizacao manual BACKUP_REAL_DATA'

for setting in DIN_BACKUP_PGHOST DIN_BACKUP_EXPECTED_PGHOST DIN_BACKUP_PGUSER \
  DIN_BACKUP_PGPASSWORD DIN_BACKUP_PGDATABASE DIN_BACKUP_AGE_RECIPIENT \
  DIN_BACKUP_LOCAL_DIR; do
  need "$setting"
done

[[ "$DIN_BACKUP_PGHOST" == "$DIN_BACKUP_EXPECTED_PGHOST" ]] || fail 'Host diferente do destino Neon verificado'
[[ "$DIN_BACKUP_PGHOST" == ep-*.neon.tech ]] || fail 'O host nao se parece com endpoint Neon'
[[ "$DIN_BACKUP_AGE_RECIPIENT" == age1* ]] || fail 'Chave publica age1 invalida'
[[ "$DIN_BACKUP_LOCAL_DIR" = /* ]] || fail 'Escolha um caminho absoluto para um diretorio existente'
[[ -d "$DIN_BACKUP_LOCAL_DIR" && -w "$DIN_BACKUP_LOCAL_DIR" ]] || fail 'Diretorio nao existe ou nao tem escrita'
[[ "$DIN_BACKUP_PGUSER" != -* && "$DIN_BACKUP_PGDATABASE" != -* ]] || fail 'Usuario/banco invalido'

outdir="$(realpath "$DIN_BACKUP_LOCAL_DIR")"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
case "$outdir/" in
  "$repo/"* ) fail 'Nao salvar arquivos de backup dentro do repositorio GitHub' ;;
esac

export PGHOST="$DIN_BACKUP_PGHOST"
export PGPORT="${DIN_BACKUP_PGPORT:-5432}"
export PGUSER="$DIN_BACKUP_PGUSER"
export PGPASSWORD="$DIN_BACKUP_PGPASSWORD"
export PGDATABASE="$DIN_BACKUP_PGDATABASE"
export PGSSLMODE=verify-full
export PGSSLROOTCERT=system

stamp="$(date -u +'%Y%m%dT%H%M%SZ')"
filename="din-production-${stamp}-$$.dump.age"
[[ ! -e "$outdir/$filename" ]] || fail 'Arquivo ja existe; nunca sobrescrever'

scratch="$(mktemp -d "$outdir/.din-encrypted-partial.XXXXXXXX")"
cleanup() { rm -f -- "$scratch/backup.age"; rmdir -- "$scratch" 2>/dev/null || true; }
trap cleanup EXIT

printf 'Exportacao somente leitura, sem novo servico pago... \n'
docker run --rm -i \
  -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGSSLROOTCERT \
  postgres:18-alpine pg_dump --format=custom --compress=6 --no-owner --no-privileges \
  --serializable-deferrable --no-password \
  | age --recipient "$DIN_BACKUP_AGE_RECIPIENT" --output "$scratch/backup.age"

[[ -s "$scratch/backup.age" ]] || fail 'Arquivo criptografado vazio'
hash="$(sha256sum "$scratch/backup.age" | cut -d' ' -f1)"
mv -- "$scratch/backup.age" "$outdir/$filename"
printf '%s  %s\n' "$hash" "$filename" > "$outdir/$filename.sha256"
printf 'Copia criptografada criada no dispositivo local: %s\n' "$filename"
printf 'SHA-256: %s\n' "$hash"
printf 'Valide a recuperacao com verify-external-backup.sh em maquina confiavel. Nao envie chaves privadas ao GitHub.\n'
