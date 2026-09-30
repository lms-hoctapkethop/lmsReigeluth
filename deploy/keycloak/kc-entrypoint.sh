#!/bin/bash
# Keycloak không đọc biến *_FILE; nạp secret từ tệp vào biến môi trường rồi chạy.
set -euo pipefail
export KC_DB_PASSWORD="$(cat "${KC_DB_PASSWORD_FROM}")"
export KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat "${KC_BOOTSTRAP_ADMIN_PASSWORD_FROM}")"
unset KC_DB_PASSWORD_FROM KC_BOOTSTRAP_ADMIN_PASSWORD_FROM
exec /opt/keycloak/bin/kc.sh start --import-realm
