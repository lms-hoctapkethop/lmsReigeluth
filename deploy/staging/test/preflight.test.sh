#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
stub="$(mktemp -d)"
trap 'rm -rf "$stub"' EXIT
cat > "$stub/docker" <<'EOF'
#!/bin/bash
set -euo pipefail
if [[ "${1:-}" == "version" ]]; then
  exit 0
fi
if [[ "${1:-}" == "compose" && "${2:-}" == "version" ]]; then
  if [[ "${3:-}" == "--short" ]]; then
    echo 2.29.7
  fi
  exit 0
fi
if [[ "${1:-}" == "compose" && "${2:-}" == "ls" ]]; then
  exit 0
fi
if [[ "${1:-}" == "network" && "${2:-}" == "ls" ]]; then
  echo net1
  exit 0
fi
if [[ "${1:-}" == "network" && "${2:-}" == "inspect" ]]; then
  cat "${HCN_NET_JSON:?}"
  exit 0
fi
if [[ "${1:-}" == "ps" ]]; then
  exit 0
fi
exit 0
EOF
cat > "$stub/ip" <<'EOF'
#!/bin/bash
if [[ "${1:-}" == "-j" && "${2:-}" == "route" ]]; then
  echo '[]'
  exit 0
fi
exit 0
EOF
chmod 755 "$stub/docker" "$stub/ip"
export PATH="$stub:$PATH"

printf '%s\n' '[{"Name":"school","IPAM":{"Config":[{"Subnet":"172.30.18.0/24"}]}}]' > "$stub/overlap.json"
export HCN_NET_JSON="$stub/overlap.json"
set +e
bash "$root/deploy/staging/preflight.sh" --quick
code=$?
set -e
[[ "$code" == "14" ]]

printf '%s\n' '[{"Name":"bridge","IPAM":{"Config":[{"Subnet":"172.17.0.0/16"}]}}]' > "$stub/clear.json"
export HCN_NET_JSON="$stub/clear.json"
set +e
bash "$root/deploy/staging/preflight.sh" --quick
code=$?
set -e
[[ "$code" != "14" ]]
echo "preflight.test ok"
