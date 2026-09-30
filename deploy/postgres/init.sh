#!/bin/bash
# Chạy một lần khi khởi tạo cluster: tạo DB Keycloak, chủ schema, tài khoản đăng nhập của app.
# Role nhóm hcn_app/hcn_worker/hcn_readonly do migration 20261001000400 tạo và cấp quyền.
set -euo pipefail
pw() { cat "/run/secrets/$1"; }

psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '$(pw pg_keycloak_password)';
CREATE DATABASE keycloak OWNER keycloak;
CREATE ROLE hcn_owner LOGIN PASSWORD '$(pw pg_owner_password)';
ALTER DATABASE hcn OWNER TO hcn_owner;
SQL

psql -v ON_ERROR_STOP=1 --username postgres --dbname hcn <<SQL
ALTER SCHEMA public OWNER TO hcn_owner;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
-- role nhóm tạo trước để GRANT được ngay; migration dùng IF NOT EXISTS
CREATE ROLE hcn_app NOLOGIN;
CREATE ROLE hcn_worker NOLOGIN;
CREATE ROLE hcn_readonly NOLOGIN;
CREATE ROLE hcn_api LOGIN PASSWORD '$(pw pg_api_password)' IN ROLE hcn_app;
CREATE ROLE hcn_worker_login LOGIN PASSWORD '$(pw pg_worker_password)' IN ROLE hcn_worker;
CREATE ROLE hcn_report LOGIN PASSWORD '$(pw pg_report_password)' IN ROLE hcn_readonly;
-- bảng tạo về sau bởi hcn_owner tự cấp quyền theo mặc định giống migration 0004
ALTER DEFAULT PRIVILEGES FOR ROLE hcn_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hcn_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hcn_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hcn_app, hcn_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE hcn_owner IN SCHEMA public GRANT SELECT ON TABLES TO hcn_worker, hcn_readonly;
SQL
