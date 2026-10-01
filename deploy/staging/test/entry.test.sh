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
echo "entry.test ok"
