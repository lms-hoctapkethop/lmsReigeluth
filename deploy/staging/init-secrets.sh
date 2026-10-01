#!/usr/bin/env bash
# Sinh secret còn thiếu. Không ghi đè tệp đã có.
set -euo pipefail
dir="${1:-/opt/hcn-staging/secrets}"
mkdir -p "$dir"
umask 077
create() {
  local path="$dir/$1"
  if [[ -e "$path" ]]; then
    return 0
  fi
  openssl rand -base64 36 | tr -d '\n' > "$path"
  chmod 600 "$path"
}
for name in \
  pg_superuser_password pg_api_password pg_worker_password pg_owner_password \
  pg_report_password pg_keycloak_password oidc_client_secret kc_provisioner_secret \
  kc_admin_password cookie_secret synthetic_user_password smoke_hs_password smoke_gv_password
do
  create "${name}.txt"
done
if [[ ! -e "$dir/database_url_api.txt" ]]; then
  printf 'postgres://hcn_api:%s@db:5432/hcn' "$(cat "$dir/pg_api_password.txt")" > "$dir/database_url_api.txt"
fi
if [[ ! -e "$dir/database_url_worker.txt" ]]; then
  printf 'postgres://hcn_worker_login:%s@db:5432/hcn' "$(cat "$dir/pg_worker_password.txt")" > "$dir/database_url_worker.txt"
fi
if [[ ! -e "$dir/database_url_owner.txt" ]]; then
  printf 'postgres://hcn_owner:%s@db:5432/hcn' "$(cat "$dir/pg_owner_password.txt")" > "$dir/database_url_owner.txt"
fi
chmod 600 "$dir"/*.txt
echo "init-secrets ok"
