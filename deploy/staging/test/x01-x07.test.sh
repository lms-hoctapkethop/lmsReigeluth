#!/usr/bin/env bash
# X01–X07. X01 và X02 gọi docker compose config thật (không stub).
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
entry="$root/deploy/staging/bin/hcn-staging"
sha=dddddddddddddddddddddddddddddddddddddddd
old=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee

names=(
  oidc_client_secret kc_provisioner_secret kc_admin_password cookie_secret
  database_url_api database_url_worker database_url_owner pg_superuser_password
  pg_api_password pg_worker_password pg_owner_password pg_report_password pg_keycloak_password
)
mkdir -p "$root/deploy/secrets"
for name in "${names[@]}"; do
  [[ -e "$root/deploy/secrets/${name}.txt" ]] || printf 'x' > "$root/deploy/secrets/${name}.txt"
done
sudo mkdir -p /opt/hcn-staging/secrets /var/lib/hcn-staging/metrics
sudo touch /opt/hcn-staging/secrets/pgbackrest.env
for name in "${names[@]}"; do
  sudo touch "/opt/hcn-staging/secrets/${name}.txt"
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
opt="$work/opt"
mkdir -p "$opt/releases/$sha" "$opt/env" "$opt/bin" "$opt/secrets"
ln -s "$root/deploy" "$opt/releases/$sha/deploy"
ln -s "$root/db" "$opt/releases/$sha/db"
ln -sfn "$opt/releases/$sha" "$opt/current"
cp "$root/deploy/staging/images.lock" "$opt/bin/images.lock"
cat > "$opt/env/staging.env" <<'EOF'
APP_DOMAIN=drill.example.edu
ID_DOMAIN=id.drill.example.edu
ACME_EMAIL=ops@example.edu
EOF
if grep -q '^APP_VERSION=' "$opt/env/staging.env"; then
  echo "staging.env không được gắn APP_VERSION" >&2
  exit 1
fi

dump_config() {
  env -u APP_VERSION -u HCN_STAGING_DRY \
    PATH="$PATH" \
    HOME="${HOME:-/tmp}" \
    HCN_STAGING_ROOT="$opt" \
    HCN_STAGING_LOCK="$work/lock" \
    HCN_STAGING_DUMP_CONFIG="$1" \
    SSH_ORIGINAL_COMMAND=status \
    bash "$entry"
}

staging_json="$work/staging.json"
drill_json="$work/drill.json"
dump_config staging > "$staging_json"
dump_config drill > "$drill_json"

python3 - "$staging_json" "$drill_json" "$sha" <<'PY'
import json, sys
staging_path, drill_path, sha = sys.argv[1:]
staging = json.load(open(staging_path, encoding="utf-8"))
drill = json.load(open(drill_path, encoding="utf-8"))
for name, image in (
    ("api", f"hcn/api:{sha}"),
    ("web", f"hcn/web:{sha}"),
    ("db", f"hcn/postgres:18-{sha}"),
):
    service = "caddy" if name == "web" else name
    got = staging["services"][service]["image"]
    if got != image:
        raise SystemExit(f"X01 {service} image {got!r} != {image!r}")
    if got.endswith(":"):
        raise SystemExit(f"X01 {service} thiếu version")
db = drill["services"]["db"]
command = " ".join(db.get("command") or [])
if "archive_mode=off" not in command:
    raise SystemExit(f"X02 thiếu archive_mode=off: {command}")
if "archive_mode=on" in command or "archive-push" in command:
    raise SystemExit(f"X02 db vẫn archive: {command}")
env_file = json.dumps(db.get("env_file") or "")
if "pgbackrest.env" in env_file:
    raise SystemExit(f"X02 db vẫn mount pgbackrest.env: {env_file}")
ports = drill["services"]["caddy"].get("ports") or []
if ports:
    raise SystemExit(f"X02 caddy còn cổng: {ports}")
print("X01 X02 compose config ok")
PY

export APP_VERSION="$sha"
export APP_DOMAIN=drill.example.edu
export ID_DOMAIN=id.drill.example.edu
export ACME_EMAIL=ops@example.edu
export HCN_RELEASE_ROOT="$root"
export HCN_IMAGES_LOCK="$root/deploy/staging/images.lock"
bash "$root/deploy/staging/bin/policy-check.sh" hcn-drill \
  -f "$root/deploy/compose.yml" \
  -f "$root/deploy/compose.staging.yml" \
  -f "$root/deploy/staging/compose.drill.yml"

stub="$(mktemp -d)"
cat > "$stub/docker" <<'EOF'
#!/bin/bash
if [[ ! -t 0 ]]; then
  cat > "${HCN_STDIN_SAVE:?}"
else
  : > "${HCN_STDIN_SAVE:?}"
fi
if [[ -s "${HCN_STDIN_SAVE}" ]]; then
  if grep -q 'CREATE TABLE release_id_snapshot' "${HCN_STDIN_SAVE}"; then
    echo "MARKER snapshot" >> "${HCN_DOCKER_LOG:?}"
  fi
  if grep -q to_regclass "${HCN_STDIN_SAVE}"; then
    echo "MARKER semantics" >> "${HCN_DOCKER_LOG:?}"
  fi
fi
printf '%s\n' "$*" >> "${HCN_DOCKER_LOG:?}"
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "--env-file" ]]; then
    src="${args[$((i + 1))]}"
    echo "env-mode $(stat -c %a "$src")" >> "${HCN_DOCKER_LOG}"
    echo "env-path $src" >> "${HCN_DOCKER_LOG}"
    n="$(find "${HCN_ENV_DIR:?}" -type f | wc -l | tr -d ' ')"
    cp "$src" "${HCN_ENV_DIR}/copy-${n}"
  fi
done
exit 0
EOF
chmod 755 "$stub/docker"
mkdir -p "$work/env-copies"

printf 'PGBACKREST_REPO2_S3_KEY=staging-secret\nPGBACKREST_REPO2_CIPHER_PASS=staging-cipher\n' > "$opt/secrets/pgbackrest.env"
printf 'RESTIC_PASSWORD=staging-restic\nRESTIC_REPOSITORY=s3:http://127.0.0.1:9/staging\n' > "$opt/secrets/restic.env"
cat > "$work/escrow.env" <<'EOF'
RESTORE_TARGET=2026-01-01T00:00:00Z
PGBACKREST_REPO2_S3_KEY=drill-key
PGBACKREST_REPO2_S3_KEY_SECRET=drill-secret
PGBACKREST_REPO2_S3_ENDPOINT=minio
PGBACKREST_REPO2_S3_BUCKET=hcn-backup
PGBACKREST_REPO2_S3_REGION=hn
PGBACKREST_REPO2_CIPHER_PASS=drill-cipher
PGBACKREST_REPO2_S3_VERIFY_TLS=n
RESTIC_REPOSITORY=s3:http://10.0.0.2:9000/hcn-files
RESTIC_PASSWORD=drill-restic
AWS_ACCESS_KEY_ID=drill-key
AWS_SECRET_ACCESS_KEY=drill-secret
EOF
chmod 600 "$work/escrow.env"

run_entry() {
  env -u APP_VERSION \
    PATH="$stub:$PATH" \
    HOME="${HOME:-/tmp}" \
    HCN_STAGING_ROOT="$opt" \
    HCN_STAGING_LOCK="$work/lock" \
    HCN_DOCKER_LOG="$work/docker.log" \
    HCN_STDIN_SAVE="$work/stdin" \
    HCN_ENV_DIR="$work/env-copies" \
    SSH_ORIGINAL_COMMAND="$1" \
    bash "$entry"
}

: > "$work/docker.log"
restore_out="$(run_entry "drill restore --escrow $work/escrow.env")"
printf '%s\n' "$restore_out" | python3 -c '
import json, sys
line = [row for row in sys.stdin.read().splitlines() if row.startswith("{")][-1]
doc = json.loads(line)
for key in ("rto_seconds", "rpo_seconds"):
    if not isinstance(doc[key], int):
        raise SystemExit(f"X06 {key} không phải số: {doc[key]!r}")
if doc["drill"] != "restore":
    raise SystemExit(doc)
'
if ! grep -q 'hcn_readonly' "$work/docker.log" || ! grep -q 'audit_log' "$work/docker.log"; then
  echo "X06 thiếu truy vấn audit_log bằng hcn_readonly" >&2
  exit 1
fi
if ! grep -q -- '-p hcn-staging' "$work/docker.log"; then
  echo "X06 không đọc staging trước diễn tập" >&2
  exit 1
fi
if grep -q 'secrets/restic.env' "$work/docker.log" || grep -q 'secrets/pgbackrest.env' "$work/docker.log"; then
  echo "X03 drill đọc secret staging" >&2
  exit 1
fi
if ! grep -q 'env-mode 600' "$work/docker.log"; then
  echo "X03 env-file không phải mode 0600" >&2
  exit 1
fi
escrow_copy=""
for copy in "$work/env-copies"/*; do
  if grep -q 'drill-cipher' "$copy" && grep -q 'drill-restic' "$copy"; then
    escrow_copy="$copy"
  fi
  if grep -q 'staging-secret' "$copy" || grep -q 'staging-restic' "$copy"; then
    echo "X03 env-file lấy nhầm secret staging" >&2
    exit 1
  fi
done
if [[ -z "$escrow_copy" ]]; then
  echo "X03 env-file thiếu khóa escrow" >&2
  exit 1
fi
while read -r _ path; do
  [[ "$path" == *staging.env ]] && continue
  if [[ -e "$path" ]]; then
    echo "X03 còn file env $path" >&2
    exit 1
  fi
done < <(grep '^env-path ' "$work/docker.log")
if grep -E 'restore latest --target' "$work/docker.log"; then
  echo "X05 còn restore latest --target" >&2
  exit 1
fi
grep -q 'restore latest:/data' "$work/docker.log"
grep -q -- '--target /data' "$work/docker.log"
python3 - "$work/docker.log" <<'PY'
import sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
restore = next(i for i, line in enumerate(lines) if "entrypoint pgbackrest" in line and "restore" in line and "--type=time" in line)
up = next(i for i, line in enumerate(lines) if " up " in line and line.rstrip().endswith(" db"))
if restore > up:
    raise SystemExit("X04 restore chạy sau khi db đã up")
print("X03 X04 X05 X06 ok")
PY

: > "$work/docker.log"
rel_out="$(run_entry "drill rel06 $old --escrow $work/escrow.env")"
printf '%s\n' "$rel_out" | grep -q "\"old_sha\":\"$old\""
python3 - "$work/docker.log" <<'PY'
import sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
def first(pred):
    for i, line in enumerate(lines):
        if pred(line):
            return i
    raise SystemExit("X07 thiếu mốc trong log")
restore = first(lambda line: "entrypoint pgbackrest" in line and "--type=latest" in line)
up = first(lambda line: " up " in line and line.rstrip().endswith(" db"))
snap = first(lambda line: line == "MARKER snapshot")
migrate = first(lambda line: "migrate" in line and line.rstrip().endswith(" up"))
sem = first(lambda line: line == "MARKER semantics")
if not (restore < up < snap < migrate < sem):
    raise SystemExit(f"X07 thứ tự sai {restore, up, snap, migrate, sem}")
print("X07 ok")
PY

echo "x01-x07.test ok"
