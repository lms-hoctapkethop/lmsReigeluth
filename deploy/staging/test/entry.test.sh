#!/usr/bin/env bash
# D01–D03, B01, R01. Mọi lần gọi entry đi qua env -i (và sudo khi máy cho phép).
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
entry="$root/deploy/staging/bin/hcn-staging"
sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
old=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

grep -F 'Defaults!/opt/hcn-staging/bin/hcn-staging env_keep += "SSH_ORIGINAL_COMMAND"' "$root/deploy/staging/install.sh" >/dev/null
grep -F 'OnCalendar=Sun *-*-* 19:00:00' "$root/deploy/staging/systemd/hcn-staging-backup-files-maintain.timer" >/dev/null
grep -F 'OnCalendar=*-*-01 19:30:00' "$root/deploy/staging/systemd/hcn-staging-backup-files-check.timer" >/dev/null
grep -F 'backup files-maintain' "$root/deploy/staging/systemd/hcn-staging-backup-files-maintain.service" >/dev/null
grep -F 'backup files-check' "$root/deploy/staging/systemd/hcn-staging-backup-files-check.service" >/dev/null
grep -F 'forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune' "$entry" >/dev/null
grep -F 'check --read-data-subset=5%' "$entry" >/dev/null
if grep -n 'echo .*drill' "$entry" | grep -q 'exit 75'; then
  echo "drill không được chỉ in thông báo rồi thoát 75" >&2
  exit 1
fi

entry_env() {
  env -i \
    PATH="$PATH" \
    HOME="${HOME:-/tmp}" \
    HCN_STAGING_ROOT="${HCN_STAGING_ROOT:-}" \
    HCN_STAGING_LOCK="${HCN_STAGING_LOCK:-}" \
    HCN_STAGING_DRY="${HCN_STAGING_DRY:-}" \
    HCN_DOCKER_LOG="${HCN_DOCKER_LOG:-}" \
    HCN_MARK="${HCN_MARK:-}" \
    SSH_ORIGINAL_COMMAND="$1" \
    bash "$entry"
}

export SSH_ORIGINAL_COMMAND=status
export HCN_STAGING_DRY=1
if env -i PATH="$PATH" HOME="${HOME:-/tmp}" HCN_STAGING_DRY=1 bash "$entry"; then
  echo "env -i đã giữ SSH_ORIGINAL_COMMAND từ tiến trình cha" >&2
  exit 1
fi
dry_status="$(env -i PATH="$PATH" HOME="${HOME:-/tmp}" HCN_STAGING_DRY=1 SSH_ORIGINAL_COMMAND=status bash "$entry")"
[[ "$dry_status" == "dry status"* ]]
for cmd in \
  "deploy aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  "perf PERF-01" \
  "backup files-maintain" \
  "backup files-check" \
  "drill restore"
do
  got="$(env -i PATH="$PATH" HOME="${HOME:-/tmp}" HCN_STAGING_DRY=1 SSH_ORIGINAL_COMMAND="$cmd" bash "$entry")"
  [[ "$got" == "dry ${cmd%% *}"* ]]
done
if env -i PATH="$PATH" HOME="${HOME:-/tmp}" HCN_STAGING_DRY=1 SSH_ORIGINAL_COMMAND='backup nope' bash "$entry"; then
  echo "backup lạ phải thoát 64" >&2
  exit 1
fi
if env -i PATH="$PATH" HOME="${HOME:-/tmp}" HCN_STAGING_DRY=1 SSH_ORIGINAL_COMMAND=nope bash "$entry"; then
  echo "lệnh lạ phải thoát 64" >&2
  exit 1
fi

if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo_bin="$(mktemp -d)"
  install -m 0755 "$entry" "$sudo_bin/hcn-staging"
  sudo_file="$(mktemp)"
  cat > "$sudo_file" <<EOF
ALL ALL=(root) NOPASSWD: $sudo_bin/hcn-staging
Defaults!$sudo_bin/hcn-staging env_keep += "SSH_ORIGINAL_COMMAND"
EOF
  sudo install -m 0440 "$sudo_file" /etc/sudoers.d/hcn-staging-entry-test
  sudo visudo -cf /etc/sudoers.d/hcn-staging-entry-test >/dev/null
  set +e
  env -u SSH_ORIGINAL_COMMAND sudo -n "$sudo_bin/hcn-staging" >/dev/null 2>&1
  bare=$?
  SSH_ORIGINAL_COMMAND=status sudo -n "$sudo_bin/hcn-staging" >/dev/null 2>&1
  kept=$?
  set -e
  sudo rm -f /etc/sudoers.d/hcn-staging-entry-test
  rm -rf "$sudo_bin" "$sudo_file"
  [[ "$bare" == "64" ]]
  [[ "$kept" != "64" ]]
fi

unset HCN_STAGING_DRY
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export HCN_STAGING_ROOT="$work/opt"
export HCN_STAGING_LOCK="$work/lock"
export HCN_DOCKER_LOG="$work/docker.log"
export HCN_MARK="$work/mark"
mkdir -p "$HCN_STAGING_ROOT/bin" "$HCN_STAGING_ROOT/env" "$HCN_STAGING_ROOT/releases/$sha/deploy/staging" "$HCN_STAGING_ROOT/secrets"
printf 'APP_DOMAIN=staging.example\nID_DOMAIN=id.example\n' > "$HCN_STAGING_ROOT/env/staging.env"
cp "$root/deploy/staging/images.lock" "$HCN_STAGING_ROOT/bin/images.lock"
cat > "$HCN_STAGING_ROOT/bin/preflight.sh" <<'EOF'
#!/bin/bash
echo bin-preflight >> "${HCN_MARK:?}"
exit 14
EOF
cat > "$HCN_STAGING_ROOT/releases/$sha/deploy/staging/preflight.sh" <<'EOF'
#!/bin/bash
echo release-preflight >> "${HCN_MARK:?}"
exit 99
EOF
chmod 755 "$HCN_STAGING_ROOT/bin/preflight.sh" "$HCN_STAGING_ROOT/releases/$sha/deploy/staging/preflight.sh"
touch "$HCN_STAGING_ROOT/releases/$sha/deploy/compose.yml"
set +e
entry_env "deploy $sha"
code=$?
set -e
[[ "$code" == "14" ]]
grep -qx bin-preflight "$HCN_MARK"
if grep -q release-preflight "$HCN_MARK"; then
  echo "deploy đã chạy preflight trong release" >&2
  exit 1
fi
# shellcheck disable=SC2016
if grep -F 'releases/${arg}/deploy/staging/preflight.sh' "$entry"; then
  echo "entry còn gọi preflight của release" >&2
  exit 1
fi
# shellcheck disable=SC2016
grep -F 'HCN_IMAGES_LOCK="$root/bin/images.lock"' "$entry" >/dev/null

stub="$(mktemp -d)"
cat > "$stub/docker" <<'EOF'
#!/bin/bash
if [[ ! -t 0 ]]; then
  cat >/dev/null
fi
printf '%s\n' "$*" >> "${HCN_DOCKER_LOG:?}"
exit 0
EOF
chmod 755 "$stub/docker"
export PATH="$stub:$PATH"

make_release() {
  local tags="$1" dest="$2"
  local stage images
  stage="$(mktemp -d)"
  images="$(mktemp -d)"
  printf '%s\n' "$tags" > "$images/manifest.json"
  tar -C "$images" -cf - manifest.json | zstd -q -o "$stage/images.tar.zst"
  mkdir -p "$stage/bundle/deploy"
  echo ok > "$stage/bundle/deploy/marker"
  tar -C "$stage/bundle" -cf "$stage/bundle.tar" deploy
  (
    cd "$stage"
    sha256sum images.tar.zst bundle.tar > manifest.sha256
    tar -cf "$dest" manifest.sha256 images.tar.zst bundle.tar
  )
  rm -rf "$stage" "$images"
}

good_tags="[{\"RepoTags\":[\"hcn/api:${sha}\",\"hcn/web:${sha}\",\"hcn/postgres:18-${sha}\"]}]"
bad_tags="[{\"RepoTags\":[\"hcn/api:${sha}\",\"hcn/web:${sha}\",\"hcn/postgres:18-${sha}\",\"postgres:18\"]}]"
make_release "$good_tags" "$work/good.tar"
make_release "$bad_tags" "$work/bad-tags.tar"
: > "$HCN_DOCKER_LOG"
set +e
entry_env "receive $sha" < "$work/bad-tags.tar"
code=$?
set -e
[[ "$code" != "0" ]]
if grep -q '^load$' "$HCN_DOCKER_LOG" || grep -q '^load ' "$HCN_DOCKER_LOG"; then
  echo "RepoTags lạ vẫn bị docker load" >&2
  exit 1
fi
rm -rf "$HCN_STAGING_ROOT/releases/$sha"
: > "$HCN_DOCKER_LOG"
entry_env "receive $sha" < "$work/good.tar"
grep -q ok "$HCN_STAGING_ROOT/releases/$sha/deploy/marker"
grep -q '^load$' "$HCN_DOCKER_LOG" || grep -q '^load ' "$HCN_DOCKER_LOG"

badsum="$(mktemp -d)"
cp "$work/good.tar" "$badsum/src.tar" >/dev/null
mkdir -p "$badsum/unpacked"
tar -xf "$work/good.tar" -C "$badsum/unpacked"
printf '0000000000000000000000000000000000000000000000000000000000000000  images.tar.zst\n' > "$badsum/unpacked/manifest.sha256"
tar -C "$badsum/unpacked" -cf "$badsum/bad.tar" manifest.sha256 images.tar.zst bundle.tar
set +e
entry_env "receive $sha" < "$badsum/bad.tar"
code=$?
set -e
[[ "$code" != "0" ]]

mkdir -p "$HCN_STAGING_ROOT/releases/$sha/db/checks"
cp "$root/db/checks/release_id_semantics.sql" "$HCN_STAGING_ROOT/releases/$sha/db/checks/release_id_semantics.sql"
ln -sfn "$HCN_STAGING_ROOT/releases/$sha" "$HCN_STAGING_ROOT/current"
printf 'RESTORE_TARGET=2026-01-01T00:00:00Z\n' > "$work/escrow.env"
unset HCN_STAGING_DRY
set +e
entry_env "drill restore"
code=$?
set -e
[[ "$code" == "75" ]]
set +e
entry_env "drill rel06 $old --escrow $work/missing.env"
code=$?
set -e
[[ "$code" == "75" ]]

: > "$HCN_DOCKER_LOG"
out="$(entry_env "drill restore --escrow $work/escrow.env")"
printf '%s\n' "$out" | grep -q '"drill":"restore"'
grep -q 'hcn-drill' "$HCN_DOCKER_LOG"
grep -q 'pgbackrest' "$HCN_DOCKER_LOG"
grep -q 'restore latest:/data' "$HCN_DOCKER_LOG"
if grep -q 'secrets/restic.env' "$HCN_DOCKER_LOG" || grep -q 'secrets/pgbackrest.env' "$HCN_DOCKER_LOG"; then
  echo "drill còn đọc secret của staging" >&2
  exit 1
fi
grep -q 'verify-files' "$HCN_DOCKER_LOG"
grep -q 'down -v' "$HCN_DOCKER_LOG" || grep -q 'down' "$HCN_DOCKER_LOG"

: > "$HCN_DOCKER_LOG"
out="$(entry_env "drill rel06 $old --escrow $work/escrow.env")"
printf '%s\n' "$out" | grep -q '"drill":"rel06"'
printf '%s\n' "$out" | grep -q "\"old_sha\":\"$old\""
grep -q 'api worker' "$HCN_DOCKER_LOG"
grep -q 'psql' "$HCN_DOCKER_LOG"
grep -q 'CREATE TABLE release_id_snapshot' "$entry"
if grep -q 'secrets/restic.env' "$HCN_DOCKER_LOG" || grep -q 'secrets/pgbackrest.env' "$HCN_DOCKER_LOG"; then
  echo "rel06 còn đọc secret của staging" >&2
  exit 1
fi

: > "$HCN_DOCKER_LOG"
entry_env "backup files-maintain" >/dev/null
grep -q 'forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune' "$HCN_DOCKER_LOG"
: > "$HCN_DOCKER_LOG"
entry_env "backup files-check" >/dev/null
grep -q 'check --read-data-subset=5%' "$HCN_DOCKER_LOG"
if grep -q 'summary-export' "$entry" && grep -q '\-e PASSWORD' "$entry"; then
  echo "perf vẫn truyền mật khẩu qua -e" >&2
  exit 1
fi
grep -q 'summary-export' "$entry"
grep -q 'docker logs' "$entry"

echo "entry.test ok"
