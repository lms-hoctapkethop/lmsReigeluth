#!/usr/bin/env bash
# X08. Diễn tập trên runner: MinIO chỉ là S3 giả, không phải dịch vụ triển khai.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo"
chmod -R a+rX deploy db
new=1111111111111111111111111111111111111111
old=2222222222222222222222222222222222222222
root=/opt/hcn-staging
entry="$repo/deploy/staging/bin/hcn-staging"
minio_url="https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z"
minio_sha=7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f
mc_url="https://github.com/minio/mc/releases/download/RELEASE.2025-08-13T08-35-41Z/mc.linux-amd64.RELEASE.2025-08-13T08-35-41Z"
mc_sha=01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891
minio_user=hcn
minio_pass=hcn-secret-e2e
payload='drill-e2e'
bindir="$(mktemp -d)"

staging_compose() {
  docker compose -p hcn-staging \
    -f "$root/current/deploy/compose.yml" \
    -f "$root/current/deploy/compose.staging.yml" \
    --env-file "$root/env/staging.env" \
    "$@"
}

drill_compose_files() {
  docker compose -p hcn-drill \
    -f "$root/current/deploy/compose.yml" \
    -f "$root/current/deploy/compose.staging.yml" \
    -f "$root/current/deploy/staging/compose.drill.yml" \
    --env-file "$root/env/staging.env" \
    "$@"
}

wal_list() {
  "$bindir/mc" ls --recursive local/hcn-backup/hcn/archive 2>/dev/null | awk '{print $NF}' | sort || true
}

on_exit() {
  local code=$?
  if [[ "$code" -ne 0 ]]; then
    echo "drill-e2e thất bại ($code). Log gần nhất:" >&2
    docker logs --tail 80 hcn-e2e-minio >&2 || true
    staging_compose logs --tail 80 >&2 || true
    drill_compose_files logs --tail 120 >&2 || true
  fi
  drill_compose_files down -v --remove-orphans >/dev/null 2>&1 || true
  staging_compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f hcn-e2e-minio >/dev/null 2>&1 || true
  rm -rf "$bindir"
  exit "$code"
}
trap on_exit EXIT

echo "Dựng ảnh hcn cho $new và $old"
docker build -f deploy/postgres/Dockerfile -t "hcn/postgres:18-${new}" deploy
docker tag "hcn/postgres:18-${new}" "hcn/postgres:18-${old}"
docker build -f deploy/api/Dockerfile -t "hcn/api:${new}" .
docker tag "hcn/api:${new}" "hcn/api:${old}"
docker build -f deploy/web/Dockerfile -t "hcn/web:${new}" .
docker tag "hcn/web:${new}" "hcn/web:${old}"

curl -fsSL -o "$bindir/minio" "$minio_url"
curl -fsSL -o "$bindir/mc" "$mc_url"
echo "${minio_sha}  ${bindir}/minio" | sha256sum -c -
echo "${mc_sha}  ${bindir}/mc" | sha256sum -c -
chmod 755 "$bindir/minio" "$bindir/mc"
docker rm -f hcn-e2e-minio >/dev/null 2>&1 || true
docker run -d --name hcn-e2e-minio --user root \
  --entrypoint /usr/local/bin/minio \
  -v "$bindir/minio:/usr/local/bin/minio:ro" \
  -p 9000:9000 \
  -e MINIO_ROOT_USER="$minio_user" \
  -e MINIO_ROOT_PASSWORD="$minio_pass" \
  "hcn/postgres:18-${new}" server /data
ready=0
for _ in $(seq 1 30); do
  if "$bindir/mc" alias set local "http://127.0.0.1:9000" "$minio_user" "$minio_pass" >/dev/null 2>&1 \
    && "$bindir/mc" ls local >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]]
"$bindir/mc" mb -p local/hcn-backup
"$bindir/mc" mb -p local/hcn-files

sudo rm -rf "$root/releases/$new" "$root/releases/$old"
sudo mkdir -p "$root/bin" "$root/env" "$root/secrets" "$root/releases/$new" "$root/releases/$old" /var/lib/hcn-staging/metrics
sudo rm -f "$root/current"
sudo chown -R "$(id -u):$(id -g)" /var/lib/hcn-staging/metrics
sudo ln -sfn "$repo/deploy" "$root/releases/$new/deploy"
sudo ln -sfn "$repo/db" "$root/releases/$new/db"
sudo ln -sfn "$repo/deploy" "$root/releases/$old/deploy"
sudo ln -sfn "$repo/db" "$root/releases/$old/db"
sudo ln -sfn "$root/releases/$new" "$root/current"
sudo cp "$repo/deploy/staging/images.lock" "$root/bin/images.lock"
sudo tee "$root/env/staging.env" >/dev/null <<'EOF'
APP_DOMAIN=drill-e2e.example.edu
ID_DOMAIN=id.drill-e2e.example.edu
ACME_EMAIL=ops@example.edu
EOF
sudo chown "$(id -u):$(id -g)" "$root/env/staging.env"

write_secret() {
  local name="$1" value="$2"
  printf '%s' "$value" | sudo tee "$root/secrets/$name" >/dev/null
  sudo chown "$(id -u):$(id -g)" "$root/secrets/$name"
  sudo chmod 644 "$root/secrets/$name"
}
write_secret pg_superuser_password.txt 'pg-super-e2e'
write_secret pg_api_password.txt 'pg-api-e2e'
write_secret pg_worker_password.txt 'pg-worker-e2e'
write_secret pg_owner_password.txt 'pg-owner-e2e'
write_secret pg_report_password.txt 'pg-report-e2e'
write_secret pg_keycloak_password.txt 'pg-keycloak-e2e'
write_secret database_url_api.txt 'postgres://hcn_api:pg-api-e2e@db:5432/hcn?sslmode=disable'
write_secret database_url_worker.txt 'postgres://hcn_worker_login:pg-worker-e2e@db:5432/hcn?sslmode=disable'
write_secret database_url_owner.txt 'postgres://hcn_owner:pg-owner-e2e@db:5432/hcn?sslmode=disable'
write_secret oidc_client_secret.txt 'oidc-e2e-secret'
write_secret kc_provisioner_secret.txt 'provisioner-e2e-secret'
write_secret kc_admin_password.txt 'kc-admin-e2e'
write_secret cookie_secret.txt 'cookie-secret-e2e-32chars-minimum'

minio_ip="$(docker inspect -f '{{.NetworkSettings.Networks.bridge.IPAddress}}' hcn-e2e-minio)"
[[ -n "$minio_ip" ]]
write_pgbackrest() {
  sudo tee "$root/secrets/pgbackrest.env" >/dev/null <<EOF
PGBACKREST_REPO2_S3_KEY=${minio_user}
PGBACKREST_REPO2_S3_KEY_SECRET=${minio_pass}
PGBACKREST_REPO2_S3_ENDPOINT=http://hcn-e2e-minio:9000
PGBACKREST_REPO2_S3_PORT=9000
PGBACKREST_REPO2_S3_BUCKET=hcn-backup
PGBACKREST_REPO2_S3_REGION=hn
PGBACKREST_REPO2_S3_URI_STYLE=path
PGBACKREST_REPO2_CIPHER_PASS=cipher-pass-e2e
PGBACKREST_REPO2_S3_VERIFY_TLS=n
PGBACKREST_ARCHIVE_ASYNC=n
EOF
  sudo chown "$(id -u):$(id -g)" "$root/secrets/pgbackrest.env"
  sudo chmod 600 "$root/secrets/pgbackrest.env"
}
write_restic() {
  sudo tee "$root/secrets/restic.env" >/dev/null <<EOF
RESTIC_REPOSITORY=s3:http://${minio_ip}:9000/hcn-files
RESTIC_PASSWORD=restic-e2e-password
AWS_ACCESS_KEY_ID=${minio_user}
AWS_SECRET_ACCESS_KEY=${minio_pass}
AWS_DEFAULT_REGION=hn
EOF
  sudo chown "$(id -u):$(id -g)" "$root/secrets/restic.env"
  sudo chmod 600 "$root/secrets/restic.env"
}
write_pgbackrest
write_restic

export APP_VERSION="$new"
export APP_DOMAIN=drill-e2e.example.edu
export ID_DOMAIN=id.drill-e2e.example.edu
export ACME_EMAIL=ops@example.edu
boot_override="$(mktemp)"
cat > "$boot_override" <<'EOF'
services:
  db:
    command:
      - postgres
      - -c
      - archive_mode=off
EOF
docker compose -p hcn-staging \
  -f "$root/current/deploy/compose.yml" \
  -f "$root/current/deploy/compose.staging.yml" \
  -f "$boot_override" \
  --env-file "$root/env/staging.env" \
  up -d --wait --wait-timeout 180 --no-build db
docker network connect hcn-staging_internal hcn-e2e-minio
staging_compose --profile ops run --rm --no-deps migrate up
sha256="$(printf '%s' "$payload" | sha256sum | awk '{print $1}')"
size="${#payload}"
staging_compose exec -T db psql -U postgres -d hcn -v ON_ERROR_STOP=1 <<SQL
INSERT INTO schools (id, code, name) VALUES ('11111111-1111-1111-1111-111111111111', 'E2E', 'Diễn tập');
INSERT INTO users (id, oidc_issuer, oidc_subject, display_name)
  VALUES ('22222222-2222-2222-2222-222222222222', 'http://keycloak:8080/realms/hcn', 'e2e', 'Diễn tập');
INSERT INTO files (id, school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name, scan_status)
  VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'e2e/blob', '${sha256}', ${size}, 'text/plain', 'note.txt', 'clean');
INSERT INTO audit_log (action, object_type, object_id) VALUES ('seed', 'file', '33333333-3333-3333-3333-333333333333');
SQL
docker run --rm -v hcn-staging_files:/data --entrypoint sh "hcn/postgres:18-${new}" \
  -c "mkdir -p /data/e2e && printf '%s' '${payload}' > /data/e2e/blob && chmod 644 /data/e2e/blob"
staging_compose exec -u postgres -T db pgbackrest --stanza=hcn stanza-create
staging_compose up -d --wait --wait-timeout 180 --force-recreate --no-build db
staging_compose exec -u postgres -T db pgbackrest --stanza=hcn check

run_entry() {
  env -u HCN_STAGING_DRY \
    PATH="$PATH" \
    HOME="${HOME:-/tmp}" \
    HCN_STAGING_ROOT="$root" \
    HCN_STAGING_LOCK="${TMPDIR:-/tmp}/hcn-staging-e2e.lock" \
    SSH_ORIGINAL_COMMAND="$1" \
    bash "$entry"
}

run_entry "backup full"
docker run --rm --env-file "$root/secrets/restic.env" \
  "$(grep -E '^restic/restic[:@]' "$root/bin/images.lock" | head -n 1)" init
run_entry "backup files"
target="$(date -u +'%Y-%m-%d %H:%M:%S+0000')"
sleep 2
staging_compose exec -T db psql -U postgres -d hcn -v ON_ERROR_STOP=1 \
  -c "INSERT INTO audit_log (action, object_type, object_id) VALUES ('later', 'file', 'after-backup')"
before_n="$(wal_list | wc -l | tr -d ' ')"
staging_compose exec -T db psql -U postgres -d hcn -v ON_ERROR_STOP=1 -c "SELECT pg_switch_wal()"
grew=0
for _ in $(seq 1 30); do
  now_n="$(wal_list | wc -l | tr -d ' ')"
  if [[ "$now_n" -gt "$before_n" ]]; then
    grew=1
    break
  fi
  sleep 2
done
[[ "$grew" == "1" ]]
staging_compose exec -T db psql -U postgres -d hcn -v ON_ERROR_STOP=1 \
  -c "ALTER SYSTEM SET archive_command = 'true'"
staging_compose exec -T db psql -U postgres -d hcn -v ON_ERROR_STOP=1 \
  -c "SELECT pg_reload_conf()"
wal_before="$(wal_list)"
printf '%s\n' "$wal_before" > /tmp/wal-before.txt

sudo tee "$root/secrets/pgbackrest.env" >/dev/null <<'EOF'
PGBACKREST_REPO2_S3_KEY=wrong
PGBACKREST_REPO2_CIPHER_PASS=wrong
EOF
sudo tee "$root/secrets/restic.env" >/dev/null <<'EOF'
RESTIC_PASSWORD=wrong
RESTIC_REPOSITORY=s3:http://127.0.0.1:9/nope
EOF
sudo chown "$(id -u):$(id -g)" "$root/secrets/pgbackrest.env" "$root/secrets/restic.env"
sudo chmod 600 "$root/secrets/pgbackrest.env" "$root/secrets/restic.env"

escrow="$(mktemp)"
chmod 600 "$escrow"
cat > "$escrow" <<EOF
RESTORE_TARGET='${target}'
PGBACKREST_REPO2_S3_KEY=${minio_user}
PGBACKREST_REPO2_S3_KEY_SECRET=${minio_pass}
PGBACKREST_REPO2_S3_ENDPOINT=http://hcn-e2e-minio:9000
PGBACKREST_REPO2_S3_PORT=9000
PGBACKREST_REPO2_S3_BUCKET=hcn-backup
PGBACKREST_REPO2_S3_REGION=hn
PGBACKREST_REPO2_S3_URI_STYLE=path
PGBACKREST_REPO2_CIPHER_PASS=cipher-pass-e2e
PGBACKREST_REPO2_S3_VERIFY_TLS=n
RESTIC_REPOSITORY=s3:http://${minio_ip}:9000/hcn-files
RESTIC_PASSWORD=restic-e2e-password
AWS_ACCESS_KEY_ID=${minio_user}
AWS_SECRET_ACCESS_KEY=${minio_pass}
AWS_DEFAULT_REGION=hn
EOF

drill_compose_files up --no-start --no-deps db
docker network connect hcn-drill_internal hcn-e2e-minio
set +e
restore_out="$(run_entry "drill restore --escrow $escrow")"
restore_code=$?
set -e
printf '%s\n' "$restore_out"
if [[ "$restore_code" -ne 0 ]]; then
  echo "restore thoát $restore_code" >&2
  exit "$restore_code"
fi
printf '%s\n' "$restore_out" | grep -E 'missing=0 mismatch=0' >/dev/null
printf '%s\n' "$restore_out" | python3 -c '
import json, sys
lines = [row for row in sys.stdin.read().splitlines() if row.startswith("{") and "rpo_seconds" in row]
doc = json.loads(lines[-1])
for key in ("rto_seconds", "rpo_seconds"):
    if not isinstance(doc[key], int) or doc[key] < 0:
        raise SystemExit(f"{key} không phải số không âm: {doc[key]!r}")
print("rpo_seconds", doc["rpo_seconds"], "rto_seconds", doc["rto_seconds"])
'
wal_after="$(wal_list)"
if [[ "$wal_before" != "$wal_after" ]]; then
  echo "Có object WAL mới trong kho staging sau diễn tập" >&2
  diff -u /tmp/wal-before.txt <(printf '%s\n' "$wal_after") >&2 || true
  exit 1
fi
echo "Không có object WAL mới trong kho staging sau diễn tập"

drill_compose_files up --no-start --no-deps db
docker network connect hcn-drill_internal hcn-e2e-minio || true
set +e
rel_out="$(run_entry "drill rel06 $old --escrow $escrow")"
rel_code=$?
set -e
printf '%s\n' "$rel_out"
if [[ "$rel_code" -ne 0 ]]; then
  echo "rel06 thoát $rel_code" >&2
  exit "$rel_code"
fi
printf '%s\n' "$rel_out" | grep -q "\"old_sha\":\"$old\""
printf '%s\n' "$rel_out" | grep -E 'missing=0 mismatch=0' >/dev/null
rm -f "$escrow"
echo "drill-e2e ok"
