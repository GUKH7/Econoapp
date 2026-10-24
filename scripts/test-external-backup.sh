#!/usr/bin/env bash
# Test fake bytes and mocked Docker/age/aws only; no production database or cloud connection.
set -Eeuo pipefail
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root/bin"
export TEST_BACKUP_LOCAL_OBJECT="$root/encrypted-upload"

cat > "$root/bin/docker" <<'SH'
#!/usr/bin/env bash
[[ " $* " == *' pg_dump '* ]] || exit 71
printf 'FAKE-POSTGRES-DUMP-NON-SENSITIVE-TEST-DATA'
SH
cat > "$root/bin/age" <<'SH'
#!/usr/bin/env bash
out=''
while (($#)); do
  case "$1" in -r) shift 2 ;; -o) out="$2"; shift 2 ;; *) exit 70 ;; esac
done
[[ -n "$out" ]] || exit 69
{ printf 'MOCK-AGE-ENCRYPTED\n'; cat; } > "$out"
SH
cat > "$root/bin/aws" <<'SH'
#!/usr/bin/env bash
args=" $* "
if [[ "$args" == *' s3api put-object '* ]]; then
  while (($#)); do
    if [[ "$1" == '--body' ]]; then cp "$2" "$TEST_BACKUP_LOCAL_OBJECT"; exit; fi
    shift
  done
elif [[ "$args" == *' s3api head-object '* ]]; then
  stat -c %s "$TEST_BACKUP_LOCAL_OBJECT"
else
  exit 68
fi
SH
chmod +x "$root/bin/"*
export PATH="$root/bin:$PATH"
export DIN_BACKUP_PGHOST='ep-example.us-east-1.aws.neon.tech'
export DIN_BACKUP_EXPECTED_PGHOST="$DIN_BACKUP_PGHOST"
export DIN_BACKUP_PGUSER='example'
export DIN_BACKUP_PGPASSWORD='TEST-SECRET-NOT-REAL'
export DIN_BACKUP_PGDATABASE='neondb'
export DIN_BACKUP_AGE_RECIPIENT='age1fakepublickey'
export DIN_BACKUP_S3_ENDPOINT='https://example.r2.cloudflarestorage.com'
export DIN_BACKUP_S3_BUCKET='din-example-backups'
export AWS_ACCESS_KEY_ID='TEST-FAKE'
export AWS_SECRET_ACCESS_KEY='TEST-SECRET-NOT-REAL'

if DIN_BACKUP_LIVE_CONFIRM='' bash "$here/backup-neon-external.sh" >"$root/rejected.log" 2>&1; then
  echo 'FAIL: backup executed without explicit confirmation'; exit 1
fi
[[ ! -f "$TEST_BACKUP_LOCAL_OBJECT" ]] || { echo 'FAIL: unauthorised upload'; exit 1; }
if DIN_BACKUP_LIVE_CONFIRM='BACKUP_REAL_DATA' DIN_BACKUP_EXPECTED_PGHOST='ep-other.neon.tech' bash "$here/backup-neon-external.sh" >"$root/rejected-host.log" 2>&1; then
  echo 'FAIL: mismatch production host was accepted'; exit 1
fi
[[ ! -f "$TEST_BACKUP_LOCAL_OBJECT" ]] || { echo 'FAIL: wrong-host upload'; exit 1; }

DIN_BACKUP_LIVE_CONFIRM='BACKUP_REAL_DATA' bash "$here/backup-neon-external.sh" >"$root/output.log"
[[ -s "$TEST_BACKUP_LOCAL_OBJECT" ]] || { echo 'FAIL: mock object missing'; exit 1; }
grep -q '^MOCK-AGE-ENCRYPTED' "$TEST_BACKUP_LOCAL_OBJECT" || { echo 'FAIL: mock encryption not applied'; exit 1; }
if grep -q 'TEST-SECRET-NOT-REAL' "$root/output.log"; then echo 'FAIL: secret leaked to logs'; exit 1; fi
printf 'PASS: explicit opt-in, endpoint pinning, encrypted upload, and object-size verification (fake data only)\n'
