#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
export HCN_STAGING_DRY=1
run() {
  SSH_ORIGINAL_COMMAND="$1" bash "$root/deploy/staging/bin/hcn-staging"
}
if SSH_ORIGINAL_COMMAND='nope' bash "$root/deploy/staging/bin/hcn-staging"; then
  echo "lệnh lạ phải thoát 64" >&2
  exit 1
fi
run "status"
run "deploy aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
run "perf PERF-01"
if SSH_ORIGINAL_COMMAND='backup nope' bash "$root/deploy/staging/bin/hcn-staging"; then
  echo "backup lạ phải thoát 64" >&2
  exit 1
fi

unset HCN_STAGING_DRY
sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
stub="$(mktemp -d)"
cat > "$stub/docker" <<'EOF'
#!/bin/bash
if [[ "${1:-}" == "load" ]]; then
  cat >/dev/null
fi
printf '%s\n' "$*" >> "${HCN_DOCKER_LOG:?}"
exit 0
EOF
chmod 755 "$stub/docker"
work="$(mktemp -d)"
stage="$work/stage"
mkdir -p "$stage/deploy"
echo ok > "$stage/deploy/marker"
tar -C "$stage" -cf "$work/bundle.tar" deploy
printf 'images\n' | zstd -q -o "$work/images.tar.zst"
(
  cd "$work"
  sha256sum images.tar.zst bundle.tar > manifest.sha256
  tar -cf release.tar manifest.sha256 images.tar.zst bundle.tar
)
bad="$work/bad"
mkdir -p "$bad"
cp "$work/images.tar.zst" "$work/bundle.tar" "$bad/"
printf '0000000000000000000000000000000000000000000000000000000000000000  images.tar.zst\n' > "$bad/manifest.sha256"
tar -C "$bad" -cf "$work/bad.tar" manifest.sha256 images.tar.zst bundle.tar
export HCN_STAGING_ROOT="$work/root"
export HCN_STAGING_LOCK="$work/lock"
export HCN_DOCKER_LOG="$work/docker.log"
mkdir -p "$HCN_STAGING_ROOT/releases"
if PATH="$stub:$PATH" SSH_ORIGINAL_COMMAND="receive $sha" bash "$root/deploy/staging/bin/hcn-staging" < "$work/bad.tar"; then
  echo "sha256 sai phải lỗi" >&2
  exit 1
fi
PATH="$stub:$PATH" SSH_ORIGINAL_COMMAND="receive $sha" bash "$root/deploy/staging/bin/hcn-staging" < "$work/release.tar"
grep -q ok "$HCN_STAGING_ROOT/releases/$sha/deploy/marker"
grep -q 'image inspect' "$HCN_DOCKER_LOG"
echo "entry.test ok"
