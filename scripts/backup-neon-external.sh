#!/usr/bin/env bash
# Encrypted read-only PostgreSQL backup to storage outside Neon. Fail closed.
set -Eeuo pipefail
umask 077
fail() { printf 'Backup aborted: %s\n' "$1" >&2; exit 1; }
need() { local key="$1"; [[ -n "${!key:-}" ]] || fail "Required setting $key is missing"; }
for bin in docker age aws sha256sum stat mktemp date; do
  command -v "$bin" >/dev/null 2>&1 || fail "Required command $bin not installed"
done
[[ "${DIN_BACKUP_LIVE_CONFIRM:-}" == 'BACKUP_REAL_DATA' ]] || fail 'Live backup is not authorized'
for var in DIN_BACKUP_PGHOST DIN_BACKUP_PGUSER DIN_BACKUP_PGPASSWORD DIN_BACKUP_PGDATABASE \
  DIN_BACKUP_EXPECTED_PGHOST DIN_BACKUP_AGE_RECIPIENT DIN_BACKUP_S3_ENDPOINT \
  DIN_BACKUP_S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  need "$var"
done
[[ "$DIN_BACKUP_PGHOST" == "$DIN_BACKUP_EXPECTED_PGHOST" ]] || fail 'Database host does not match approved production endpoint'
[[ "$DIN_BACKUP_PGHOST" == ep-*.neon.tech ]] || fail 'Refusing to back up an unrecognized host'
[[ "$DIN_BACKUP_S3_ENDPOINT" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || fail 'Object-storage endpoint must be HTTPS without credentials or query parameters'
[[ "$DIN_BACKUP_S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail 'Invalid destination bucket name'
[[ "$DIN_BACKUP_AGE_RECIPIENT" == age1* ]] || fail 'Expected an age recipient public key'
[[ "$DIN_BACKUP_PGUSER" != -* && "$DIN_BACKUP_PGDATABASE" != -* ]] || fail 'Invalid database settings'

# Never print or pass database credentials in process arguments.
export PGHOST="$DIN_BACKUP_PGHOST"
export PGPORT="${DIN_BACKUP_PGPORT:-5432}"
export PGUSER="$DIN_BACKUP_PGUSER"
export PGPASSWORD="$DIN_BACKUP_PGPASSWORD"
export PGDATABASE="$DIN_BACKUP_PGDATABASE"
export PGSSLMODE=verify-full
export PGSSLROOTCERT=system
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_EC2_METADATA_DISABLED=true

stamp="$(date -u +'%Y%m%dT%H%M%SZ')"
run_id="${GITHUB_RUN_ID:-manual-$$}"
attempt="${GITHUB_RUN_ATTEMPT:-1}"
[[ "$run_id" =~ ^[A-Za-z0-9-]+$ && "$attempt" =~ ^[0-9]+$ ]] || fail 'Invalid run metadata'

# Only encrypted bytes touch disk. Unique key per run, no remote deletion.
tmpdir="$(mktemp -d)"
trap 'rm -rf -- "$tmpdir"' EXIT
cipher="$tmpdir/din.dump.age"
key="din/production/${stamp}-${run_id}-${attempt}.dump.age"

printf 'Creating encrypted pg_dump stream from approved Neon endpoint...\n'
docker run --rm -i \
  -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGSSLROOTCERT \
  postgres:18-alpine pg_dump --format=custom --compress=6 --no-owner --no-privileges \
  --serializable-deferrable --no-password \
  | age -r "$DIN_BACKUP_AGE_RECIPIENT" -o "$cipher"

[[ -s "$cipher" ]] || fail 'Encrypted backup is empty'
digest="$(sha256sum "$cipher" | cut -d' ' -f1)"
size="$(stat -c %s "$cipher")"
aws --endpoint-url "$DIN_BACKUP_S3_ENDPOINT" s3api put-object \
  --bucket "$DIN_BACKUP_S3_BUCKET" --key "$key" --body "$cipher" \
  --metadata "sha256=$digest" --output json >/dev/null
remote_size="$(aws --endpoint-url "$DIN_BACKUP_S3_ENDPOINT" s3api head-object \
  --bucket "$DIN_BACKUP_S3_BUCKET" --key "$key" --query ContentLength --output text)"
[[ "$remote_size" == "$size" ]] || fail 'Upload size verification failed; keep the object for inspection'
printf 'Encrypted backup uploaded and size-verified. Object key: %s; bytes: %s; sha256: %s\n' "$key" "$size" "$digest"
