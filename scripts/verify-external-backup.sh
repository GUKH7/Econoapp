#!/usr/bin/env bash
# Offline recovery drill of an age-encrypted backup into an ephemeral, isolated local Postgres.
# DO NOT run on a shared machine or a production DB server.
set -Eeuo pipefail
umask 077
fail() { printf 'Restore drill aborted: %s\n' "$1" >&2; exit 1; }
[[ $# -eq 2 ]] || fail 'Usage: verify-external-backup.sh <encrypted-file.dump.age> <age-private-key-file>'
cipher="$1"
identity="$2"
[[ -f "$cipher" && -f "$identity" ]] || fail 'Encrypted file or private key not found'
for bin in age docker openssl date; do command -v "$bin" >/dev/null 2>&1 || fail "Missing command: $bin"; done

# No port mapping, no persistent disk volume, and no external network. Data stays on the local test host.
name="din-restore-drill-$(date -u +%s)-$$"
pass="$(openssl rand -hex 24)"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD="$pass" postgres:18-alpine >/dev/null
ready=0
for _ in {1..40}; do
  if docker exec "$name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" -eq 1 ]] || fail 'Temporary local database did not become ready'

printf 'Decrypting and restoring into an isolated, temporary PostgreSQL container...\n'
age --decrypt -i "$identity" "$cipher" \
  | docker exec -i "$name" pg_restore --exit-on-error --no-owner --no-privileges \
      --username=postgres --dbname=postgres

# Prints only aggregate counts, never row-level financial or account information.
docker exec "$name" psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c 'SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_type = '\''BASE TABLE'\'') AS tables, (SELECT COUNT(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations, (SELECT COUNT(*) FROM public."Transaction") AS transactions, (SELECT COUNT(*) FROM public."FinancialAccount") AS accounts;'
printf 'Restore drill passed. Temporary container removed on exit.\n'
