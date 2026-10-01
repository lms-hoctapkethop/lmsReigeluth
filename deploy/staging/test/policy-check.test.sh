#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
mkdir -p deploy/secrets
for name in oidc_client_secret kc_provisioner_secret kc_admin_password cookie_secret \
  database_url_api database_url_worker database_url_owner pg_superuser_password \
  pg_api_password pg_worker_password pg_owner_password pg_report_password pg_keycloak_password
do
  [[ -e "deploy/secrets/${name}.txt" ]] || printf 'x' > "deploy/secrets/${name}.txt"
done
sudo mkdir -p /opt/hcn-staging/secrets /var/lib/hcn-staging/metrics
sudo touch /opt/hcn-staging/secrets/pgbackrest.env
export APP_VERSION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export APP_DOMAIN=staging-lms.hoctapkethop.edu.vn
export ID_DOMAIN=id-staging-lms.hoctapkethop.edu.vn
export ACME_EMAIL=ops@example.edu.vn
export HCN_RELEASE_ROOT="$root"
export HCN_IMAGES_LOCK="$root/deploy/staging/images.lock"
bash deploy/staging/bin/policy-check.sh hcn-staging -f deploy/compose.yml -f deploy/compose.staging.yml

bad="$(mktemp -d)"
cat > "$bad/compose.yml" <<'EOF'
services:
  evil:
    image: busybox:latest
    privileged: true
    ports: ["0.0.0.0:80:80"]
EOF
if bash deploy/staging/bin/policy-check.sh hcn-staging -f "$bad/compose.yml"; then
  echo "policy-check đã chấp nhận compose xấu" >&2
  exit 1
fi
echo "policy-check.test ok"
