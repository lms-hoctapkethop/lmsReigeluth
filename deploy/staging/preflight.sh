#!/usr/bin/env bash
# Chỉ đọc. Không cần mạng. Mã thoát theo docs/08 mục 0.13.
set -euo pipefail
quick=0
if [[ "${1:-}" == "--quick" ]]; then
  quick=1
fi

echo "preflight $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "os=${NAME:-unknown} ${VERSION_ID:-}"
fi
echo "nproc=$(nproc)"
if [[ -r /proc/meminfo ]]; then
  awk '/MemAvailable/ {print "MemAvailable_kB="$2}' /proc/meminfo
fi
if [[ -d /var/lib/docker ]]; then
  df -Pk /var/lib/docker | awk 'NR==2 {print "disk_avail_kB="$4}'
else
  df -Pk / | awk 'NR==2 {print "disk_avail_kB="$4}'
fi
if command -v docker >/dev/null 2>&1; then
  docker version --format 'docker={{.Server.Version}}' || true
  docker compose version || true
  docker compose ls || true
fi
if command -v ss >/dev/null 2>&1; then
  ss -ltnp | awk 'NR==1 || /:80 |:443 |:18080 |:19090 /'
fi
if command -v ufw >/dev/null 2>&1; then
  ufw status || true
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "thiếu docker" >&2
  exit 13
fi
compose_ver="$(docker compose version --short 2>/dev/null || echo 0)"
python3 - "$compose_ver" <<'PY'
import sys
raw = sys.argv[1].split("-", 1)[0]
parts = [int(item) for item in raw.split(".") if item.isdigit()]
while len(parts) < 2:
    parts.append(0)
if (parts[0], parts[1]) < (2, 24):
    raise SystemExit(13)
PY

python3 - <<'PY'
import ipaddress, json, subprocess, sys
target = ipaddress.ip_network("172.30.18.0/24")

def overlaps(subnet: str) -> bool:
    try:
        return target.overlaps(ipaddress.ip_network(subnet, strict=False))
    except ValueError:
        return False

ids = subprocess.check_output(["docker", "network", "ls", "-q"], text=True).split()
if ids:
    raw = subprocess.check_output(["docker", "network", "inspect", *ids], text=True)
    for net in json.loads(raw):
        for cfg in (net.get("IPAM") or {}).get("Config") or []:
            if cfg.get("Subnet") and overlaps(cfg["Subnet"]):
                print(f"subnet trùng network {net.get('Name')}", file=sys.stderr)
                raise SystemExit(14)
try:
    routes = subprocess.check_output(["ip", "-j", "route"], text=True)
    for route in json.loads(routes):
        dst = route.get("dst")
        if dst and dst != "default" and overlaps(dst):
            print(f"subnet trùng route {dst}", file=sys.stderr)
            raise SystemExit(14)
except (FileNotFoundError, subprocess.CalledProcessError, json.JSONDecodeError):
    pass
PY

if command -v ss >/dev/null 2>&1; then
  busy=0
  for port in 18080 19090; do
    if ss -ltn | awk '{print $4}' | grep -Eq ":${port}$"; then
      project="$(docker ps --filter "publish=${port}" --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | head -n 1 || true)"
      if [[ "$quick" -eq 1 && ( "$project" == "hcn-staging" || "$project" == "hcn-drill" ) ]]; then
        continue
      fi
      busy=1
    fi
  done
  if (( busy == 1 )); then
    echo "cổng 18080 hoặc 19090 đang dùng" >&2
    exit 10
  fi
  holder="$(ss -ltnp 2>/dev/null | awk '/:443 / {print}' || true)"
  if echo "$holder" | grep -q 'docker'; then
    echo "cổng 443 do container giữ" >&2
    exit 12
  fi
fi

if [[ "$quick" -eq 0 ]]; then
  avail_kb="$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"
  disk_kb="$(df -Pk /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')"
  disk_kb="${disk_kb:-$(df -Pk / | awk 'NR==2 {print $4}')}"
  # Ngân sách staging 5,5 GB; cần còn ≥ 2 GB sau ngân sách, và ≥ 40 GB đĩa.
  python3 - "$avail_kb" "$disk_kb" <<'PY'
import sys
mem = int(sys.argv[1])
disk = int(sys.argv[2])
need_mem = (5500 + 2048) * 1024
need_disk = 40 * 1024 * 1024
if mem < need_mem or disk < need_disk:
    raise SystemExit(11)
PY
fi
echo "preflight ok"
