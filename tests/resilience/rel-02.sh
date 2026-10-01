#!/usr/bin/env bash
# REL-02: process.exit(1) chỉ khi HCN_ENV=test và đúng tên lệnh.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
script="$root/tests/resilience/rel-02.mjs"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
invoke() {
  local env_name="$1" fault="$2" command_name="$3" outfile="$4"
  env -i PATH="$PATH" HCN_ENV="$env_name" HCN_FAULT_AFTER_COMMIT="$fault" \
    node --experimental-strip-types "$script" "$command_name" >"$outfile"
}
set +e
invoke test submitAssignment submitAssignment "$work/die.txt"
die=$?
invoke staging submitAssignment submitAssignment "$work/staging.txt"
staging=$?
invoke production submitAssignment submitAssignment "$work/prod.txt"
prod=$?
invoke test submitAssignment other "$work/other.txt"
other=$?
set -e
[[ "$die" == "1" ]]
[[ "$staging" == "0" ]]
[[ "$prod" == "0" ]]
[[ "$other" == "0" ]]
grep -q alive "$work/staging.txt"
grep -q alive "$work/prod.txt"
grep -q alive "$work/other.txt"
if grep -q alive "$work/die.txt"; then
  echo "fault đã in alive sau process.exit" >&2
  exit 1
fi
echo "rel-02 ok"
