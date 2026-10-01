#!/usr/bin/env bash
# Từ chối compose staging nếu lệch chính sách docs/08 mục 0.5.
set -euo pipefail

project="${1:-hcn-staging}"
shift || true
if [[ "$project" != "hcn-staging" && "$project" != "hcn-drill" ]]; then
  echo "project không được phép: $project" >&2
  exit 1
fi

release_root="${HCN_RELEASE_ROOT:-$(pwd)}"
lock_file="${HCN_IMAGES_LOCK:-deploy/staging/images.lock}"
version="${APP_VERSION:?APP_VERSION}"

json_file="$(mktemp)"
trap 'rm -f "$json_file"' EXIT
docker compose -p "$project" "$@" config --format json > "$json_file"

python3 - "$json_file" "$project" "$release_root" "$lock_file" "$version" <<'PY'
import json, sys
json_file, project, release_root, lock_file, version = sys.argv[1:6]
with open(json_file, encoding="utf-8") as handle:
    doc = json.load(handle)
allowed_images = set()
with open(lock_file, encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if line and not line.startswith("#"):
            allowed_images.add(line)
allowed_hcn = {
    f"hcn/api:{version}",
    f"hcn/web:{version}",
    f"hcn/postgres:18-{version}",
}
allowed_ports = {"127.0.0.1:18080", "127.0.0.1:19090"}
errors = []
for name, service in (doc.get("services") or {}).items():
    profiles = service.get("profiles") or []
    if "never" in profiles:
        continue
    if service.get("privileged"):
        errors.append(f"{name}: privileged")
    if service.get("cap_add"):
        errors.append(f"{name}: cap_add")
    if service.get("devices"):
        errors.append(f"{name}: devices")
    for key in ("pid", "ipc", "network_mode"):
        if service.get(key):
            errors.append(f"{name}: {key}={service.get(key)}")
    if service.get("volumes_from"):
        errors.append(f"{name}: volumes_from")
    if service.get("userns_mode"):
        errors.append(f"{name}: userns_mode")
    if service.get("cgroup_parent"):
        errors.append(f"{name}: cgroup_parent")
    if service.get("build"):
        errors.append(f"{name}: build")
    for opt in service.get("security_opt") or []:
        if "unconfined" in opt:
            errors.append(f"{name}: security_opt unconfined")
    image = service.get("image") or ""
    if image.startswith("hcn/"):
        if image not in allowed_hcn:
            errors.append(f"{name}: image {image}")
    elif image not in allowed_images:
        errors.append(f"{name}: image ngoài danh sách {image}")
    for port in service.get("ports") or []:
        host = str(port.get("host_ip") or "")
        published = str(port.get("published") or port.get("target") or "")
        pair = f"{host}:{published}"
        if pair not in allowed_ports:
            errors.append(f"{name}: cổng {pair}")
    for mount in service.get("volumes") or []:
        if isinstance(mount, str):
            continue
        if mount.get("type") != "bind":
            continue
        source = mount.get("source") or ""
        if "/var/run/docker.sock" in source:
            errors.append(f"{name}: docker.sock")
            continue
        allowed = source.startswith("/opt/hcn-staging/secrets/") or source.startswith("/var/lib/hcn-staging/metrics")
        allowed = allowed or source.startswith(release_root.rstrip("/") + "/") or source == release_root
        if not allowed:
            errors.append(f"{name}: bind {source}")
prefix = f"{project}_"
for name, volume in (doc.get("volumes") or {}).items():
    if volume.get("external"):
        errors.append(f"volume {name}: external")
    if volume.get("driver_opts"):
        errors.append(f"volume {name}: driver_opts")
    vol_name = volume.get("name") or ""
    if vol_name and not vol_name.startswith(prefix):
        errors.append(f"volume {name}: name {vol_name}")
for name, network in (doc.get("networks") or {}).items():
    if network.get("external"):
        errors.append(f"network {name}: external")
    driver = network.get("driver")
    if driver and driver != "bridge":
        errors.append(f"network {name}: driver {driver}")
allowed_secret_roots = ("/opt/hcn-staging/secrets/", release_root.rstrip("/") + "/")
for kind in ("secrets", "configs"):
    for name, item in (doc.get(kind) or {}).items():
        source = item.get("file") or ""
        if not source:
            continue
        if source.startswith(allowed_secret_roots):
            continue
        errors.append(f"{kind} {name}: file {source}")
if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
print("policy-check ok")
PY
