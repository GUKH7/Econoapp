#!/usr/bin/env bash
# Non-sensitive local export mock: never accesses Neon, Render or paid object storage.
set -Eeuo pipefail
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/bin" "$work/storage"

cat > "$work/bin/docker" <<'SH'
#!/usr/bin/env bash
[[ " $* " == *' pg_dump '* ]] || exit 30
printf 'ONLY_SYNTHETIC_POSTGRES_BYTES'
SH
cat > "$work/bin/age" <<'SH'
#!/usr/bin/env bash
out=''
while (($#)); do
  case "$1" in --recipient) shift 2 ;; --output) out="$2"; shift 2 ;; *) exit 31 ;; esac
done
[[ -n "$out" ]] || exit 32
{ printf 'MOCK_AGE_CIPHERTEXT\n'; cat; } > "$out"
SH
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH"
export DIN_BACKUP_PGHOST='ep-fake.us-east-1.aws.neon.tech'
export DIN_BACKUP_EXPECTED_PGHOST="$DIN_BACKUP_PGHOST"
export DIN_BACKUP_PGUSER=synthetic
export DIN_BACKUP_PGPASSWORD='FAKE_PASSWORD_DO_NOT_USE'
export DIN_BACKUP_PGDATABASE=synthetic
export DIN_BACKUP_AGE_RECIPIENT='age1fakeonly'
export DIN_BACKUP_LOCAL_DIR="$work/storage"

if bash "$here/backup-neon-local.sh" > "$work/no-approval.log" 2>&1; then
  echo 'FAIL: exported without approval'; exit 1
fi
[[ -z "$(find "$work/storage" -type f -print -quit)" ]] || { echo 'FAIL: backup before approval'; exit 1; }

if DIN_BACKUP_LIVE_CONFIRM=BACKUP_REAL_DATA \
   DIN_BACKUP_EXPECTED_PGHOST='ep-incorrect.neon.tech' \
   bash "$here/backup-neon-local.sh" >"$work/wrong-host.log" 2>&1; then
  echo 'FAIL: accepted mismatched Neon host'; exit 1
fi
[[ -z "$(find "$work/storage" -type f -print -quit)" ]] || { echo 'FAIL: backup on wrong host'; exit 1; }

DIN_BACKUP_LIVE_CONFIRM=BACKUP_REAL_DATA bash "$here/backup-neon-local.sh" >"$work/accepted.log"
file="$(find "$work/storage" -maxdepth 1 -name '*.dump.age' -print -quit)"
[[ -s "$file" ]] || { echo 'FAIL: no encrypted local file'; exit 1; }
grep -q '^MOCK_AGE_CIPHERTEXT' "$file" || { echo 'FAIL: missing encryption marker'; exit 1; }
[[ -f "$file.sha256" ]] || { echo 'FAIL: missing hash manifest'; exit 1; }
(cd "$work/storage" && sha256sum --check "$(basename "$file").sha256" >/dev/null)
if grep -q "$DIN_BACKUP_PGPASSWORD" "$work/accepted.log"; then echo 'FAIL: log leaked secret'; exit 1; fi

# Refuse placing backup inside the repository even if user explicitly supplies it.
if DIN_BACKUP_LIVE_CONFIRM=BACKUP_REAL_DATA DIN_BACKUP_LOCAL_DIR="$(cd "$here/.." && pwd -P)" \
   bash "$here/backup-neon-local.sh" >"$work/in-repo.log" 2>&1; then
  echo 'FAIL: backup allowed in Git repository'; exit 1
fi
echo 'PASS: zero-cost local backup gates, fake encryption output and SHA256 validation'
