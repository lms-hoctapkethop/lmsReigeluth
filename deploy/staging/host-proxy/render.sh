#!/usr/bin/env bash
# Tải dải IP Cloudflare và in một tệp nginx hoàn chỉnh ra stdout.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
template="$here/nginx-staging.conf"
v4="${HCN_CF_IPS_V4_FILE:-}"
v6="${HCN_CF_IPS_V6_FILE:-}"
cleanup=""
if [[ -z "$v4" || -z "$v6" ]]; then
  work="$(mktemp -d)"
  cleanup="$work"
  v4="$work/ips-v4"
  v6="$work/ips-v6"
  curl -fsSL --max-time 30 https://www.cloudflare.com/ips-v4 -o "$v4"
  curl -fsSL --max-time 30 https://www.cloudflare.com/ips-v6 -o "$v6"
fi
if [[ -n "$cleanup" ]]; then
  trap 'rm -rf "$cleanup"' EXIT
fi
python3 - "$template" "$v4" "$v6" <<'PY'
import pathlib, re, sys
template, v4_path, v6_path = sys.argv[1:]
cidr = re.compile(r"^[0-9a-fA-F:.]+/[0-9]{1,3}$")
lines = []
for path in (v4_path, v6_path):
    for raw in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        item = raw.strip()
        if not item or item.startswith("#"):
            continue
        if not cidr.match(item):
            print(f"dải IP không hợp lệ: {item}", file=sys.stderr)
            raise SystemExit(1)
        lines.append(f"  set_real_ip_from {item};")
if not lines:
    print("danh sách Cloudflare trống", file=sys.stderr)
    raise SystemExit(1)
text = pathlib.Path(template).read_text(encoding="utf-8")
block = "\n".join(lines)
if "__CLOUDFLARE_REAL_IP__" not in text:
    print("mẫu nginx thiếu chỗ chèn dải IP", file=sys.stderr)
    raise SystemExit(1)
rendered = text.replace("  __CLOUDFLARE_REAL_IP__", block)
if "set_real_ip_from ;" in rendered or "__CLOUDFLARE_REAL_IP__" in rendered:
    print("mẫu còn set_real_ip_from trống", file=sys.stderr)
    raise SystemExit(1)
sys.stdout.write(rendered)
if not rendered.endswith("\n"):
    sys.stdout.write("\n")
PY
