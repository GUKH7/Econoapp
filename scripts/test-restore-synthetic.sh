#!/usr/bin/env bash
# Synthetic age -> pg_dump -> pg_restore round-trip only. No Neon/Render/R2 access.
set -Eeuo pipefail
umask 077
for bin in docker age age-keygen mktemp grep; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing tool: $bin" >&2; exit 1; }
done
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d)"
source_container="din-source-fixture-$$"
cleanup() { docker rm -f "$source_container" >/dev/null 2>&1 || true; rm -rf -- "$workdir"; }
trap cleanup EXIT

docker run --rm -d --network none --name "$source_container" -e POSTGRES_PASSWORD=only-fake-data postgres:18-alpine >/dev/null
ready=0
for _ in {1..40}; do
  if docker exec "$source_container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" -eq 1 ]] || { echo 'Synthetic PostgreSQL unavailable' >&2; exit 1; }

docker exec -i "$source_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE public."FinancialAccount" (id INTEGER PRIMARY KEY);
CREATE TABLE public."Transaction" (id INTEGER PRIMARY KEY, "accountId" INTEGER REFERENCES public."FinancialAccount" (id));
CREATE TABLE public."_prisma_migrations" (id TEXT PRIMARY KEY, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ);
INSERT INTO public."FinancialAccount" (id) VALUES (7);
INSERT INTO public."Transaction" (id,"accountId") VALUES (9,7);
INSERT INTO public."_prisma_migrations" (id,finished_at) VALUES ('only-fake-migration',now());
SQL
age-keygen -o "$workdir/private.agekey" >/dev/null 2>&1
recipient="$(age-keygen -y "$workdir/private.agekey")"
docker exec "$source_container" pg_dump -U postgres -d postgres -Fc -Z 6 --no-owner --no-privileges \
  | age -r "$recipient" -o "$workdir/test.dump.age"

result="$(bash "$repo/scripts/verify-external-backup.sh" "$workdir/test.dump.age" "$workdir/private.agekey")"
printf '%s\n' "$result" | grep -q '^3|1|1|1$' || { echo 'Restored fixture count mismatch' >&2; exit 1; }
echo 'PASS: synthetic encrypted backup restored into isolated PostgreSQL and counts matched.'
