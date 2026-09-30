-- migrate:up
-- Học cùng nhau 3.0 · 0004 vai trò DB: tách quyền API và worker (INV-11).
-- Role nhóm NOLOGIN; tài khoản đăng nhập tạo khi triển khai (deploy/postgres/init.sh) và GRANT vào nhóm.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hcn_app') THEN CREATE ROLE hcn_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hcn_worker') THEN CREATE ROLE hcn_worker NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hcn_readonly') THEN CREATE ROLE hcn_readonly NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO hcn_app, hcn_worker, hcn_readonly;

-- API: đọc ghi toàn bộ bảng nghiệp vụ; trigger chặn sửa bảng bất biến
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hcn_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hcn_app;

-- Worker: đọc mọi thứ trừ khóa đáp án; chỉ ghi các bảng dẫn xuất và hạ tầng
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hcn_worker;
REVOKE SELECT ON question_keys FROM hcn_worker;
GRANT INSERT ON observations, needs_estimates, notifications, audit_log TO hcn_worker;
GRANT INSERT, UPDATE ON misconception_signals, processed_events TO hcn_worker;
GRANT UPDATE (status, attempts, last_error, available_at, processed_at) ON outbox_events TO hcn_worker;
GRANT UPDATE (scan_status, scanned_at) ON files TO hcn_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hcn_worker;

-- Báo cáo: chỉ đọc, không đọc khóa đáp án và phiên
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hcn_readonly;
REVOKE SELECT ON question_keys, sessions, idempotency_keys FROM hcn_readonly;

-- migrate:down
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hcn_app, hcn_worker, hcn_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hcn_app, hcn_worker, hcn_readonly;
REVOKE USAGE ON SCHEMA public FROM hcn_app, hcn_worker, hcn_readonly;
