#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
names=(
  oidc_client_secret kc_provisioner_secret kc_admin_password cookie_secret
  database_url_api database_url_worker database_url_owner pg_superuser_password
  pg_api_password pg_worker_password pg_owner_password pg_report_password pg_keycloak_password
)
mkdir -p deploy/secrets
for name in "${names[@]}"; do
  [[ -e "deploy/secrets/${name}.txt" ]] || printf 'x' > "deploy/secrets/${name}.txt"
done
sudo mkdir -p /opt/hcn-staging/secrets /var/lib/hcn-staging/metrics
sudo touch /opt/hcn-staging/secrets/pgbackrest.env
for name in "${names[@]}"; do
  sudo touch "/opt/hcn-staging/secrets/${name}.txt"
done
export APP_VERSION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export APP_DOMAIN=staging-lms.hoctapkethop.edu.vn
export ID_DOMAIN=id-staging-lms.hoctapkethop.edu.vn
export ACME_EMAIL=ops@example.edu.vn
export HCN_RELEASE_ROOT="$root"
export HCN_IMAGES_LOCK="$root/deploy/staging/images.lock"
bash deploy/staging/bin/policy-check.sh hcn-staging -f deploy/compose.yml -f deploy/compose.staging.yml

expect_reject() {
  local label="$1" needle="$2"
  local file err
  file="$(mktemp)"
  err="$(mktemp)"
  cat > "$file"
  if bash deploy/staging/bin/policy-check.sh hcn-staging -f "$file" >"$err.out" 2>"$err"; then
    echo "$label đã được chấp nhận" >&2
    exit 1
  fi
  if ! grep -q "$needle" "$err"; then
    echo "$label không báo $needle" >&2
    cat "$err" >&2
    exit 1
  fi
  rm -f "$file" "$err" "$err.out"
}

expect_reject "volume external" "external" <<'EOF'
services:
  app:
    image: busybox:latest
    volumes: [school:/data]
volumes:
  school:
    external: true
    name: school_data
EOF

expect_reject "network external" "external" <<'EOF'
services:
  app:
    image: busybox:latest
    networks: [school]
networks:
  school:
    external: true
    name: school_net
EOF

expect_reject "driver_opts" "driver_opts" <<'EOF'
services:
  app:
    image: busybox:latest
    volumes: [data:/data]
volumes:
  data:
    driver: local
    driver_opts:
      type: none
      device: /
      o: bind
EOF

expect_reject "network_mode container" "network_mode" <<'EOF'
services:
  app:
    image: busybox:latest
    network_mode: "container:school"
EOF

expect_reject "volumes_from" "volumes_from" <<'EOF'
services:
  other:
    image: busybox:latest
  app:
    image: busybox:latest
    volumes_from: [other]
EOF

expect_reject "secret ngoài thư mục" "/etc/hostname" <<'EOF'
services:
  app:
    image: busybox:latest
    secrets: [leak]
secrets:
  leak:
    file: /etc/hostname
EOF

expect_reject "userns_mode" "userns_mode" <<'EOF'
services:
  app:
    image: busybox:latest
    userns_mode: host
EOF

expect_reject "build" "build" <<'EOF'
services:
  app:
    build: .
    image: busybox:latest
EOF

echo "policy-check.test ok"
