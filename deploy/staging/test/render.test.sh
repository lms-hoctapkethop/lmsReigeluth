#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
render="$root/deploy/staging/host-proxy/render.sh"
out="$(mktemp)"
empty="$(mktemp -d)"
trap 'rm -rf "$empty" "$out"' EXIT
: > "$empty/v4"
: > "$empty/v6"
if HCN_CF_IPS_V4_FILE="$empty/v4" HCN_CF_IPS_V6_FILE="$empty/v6" bash "$render" >"$out"; then
  echo "danh sách trống phải lỗi" >&2
  exit 1
fi
printf '%s\n' '1.1.1.0/24' > "$empty/v4"
printf '%s\n' '2606:4700::/32' > "$empty/v6"
HCN_CF_IPS_V4_FILE="$empty/v4" HCN_CF_IPS_V6_FILE="$empty/v6" bash "$render" >"$out"
grep -q 'set_real_ip_from 1.1.1.0/24;' "$out"
grep -q 'set_real_ip_from 2606:4700::/32;' "$out"
grep -q 'listen \[::\]:443 ssl;' "$out"
grep -q 'http2 on;' "$out"
grep -q 'X-Forwarded-Proto https;' "$out"
# shellcheck disable=SC2016
grep -q 'X-Forwarded-For $remote_addr;' "$out"
# shellcheck disable=SC2016
grep -q 'proxy_set_header Host $host;' "$out"
if grep -q 'set_real_ip_from ;' "$out"; then
  echo "còn set_real_ip_from trống" >&2
  exit 1
fi
live="$(mktemp)"
bash "$render" >"$live"
grep -q 'set_real_ip_from ' "$live"
grep -q 'listen \[::\]:443 ssl;' "$live"
if grep -q 'set_real_ip_from ;' "$live"; then
  echo "bản tải về còn set_real_ip_from trống" >&2
  exit 1
fi
rm -f "$live"
echo "render.test ok"
