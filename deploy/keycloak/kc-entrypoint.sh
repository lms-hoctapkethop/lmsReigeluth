#!/bin/bash
# Keycloak không đọc biến *_FILE. Render realm vào thư mục import rồi chạy kc.sh.
set -euo pipefail
KC_DB_PASSWORD="$(cat "${KC_DB_PASSWORD_FROM}")"
KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat "${KC_BOOTSTRAP_ADMIN_PASSWORD_FROM}")"
export KC_DB_PASSWORD KC_BOOTSTRAP_ADMIN_PASSWORD
unset KC_DB_PASSWORD_FROM KC_BOOTSTRAP_ADMIN_PASSWORD_FROM

realm_src="${HCN_REALM_FILE:-/opt/hcn/realm-hcn.json}"
app_domain="${APP_DOMAIN:?APP_DOMAIN}"
oidc_secret="$(cat "${OIDC_CLIENT_SECRET_FILE:-/run/secrets/oidc_client_secret}")"
provisioner_secret="$(cat "${KC_PROVISIONER_SECRET_FILE:-/run/secrets/kc_provisioner_secret}")"
mkdir -p /opt/keycloak/data/import
sed \
  -e "s/__APP_DOMAIN__/${app_domain}/g" \
  -e "s/__OIDC_CLIENT_SECRET__/${oidc_secret}/g" \
  -e "s/__PROVISIONER_SECRET__/${provisioner_secret}/g" \
  "$realm_src" > /opt/keycloak/data/import/realm-hcn.json
chmod 600 /opt/keycloak/data/import/realm-hcn.json
exec /opt/keycloak/bin/kc.sh start --import-realm
