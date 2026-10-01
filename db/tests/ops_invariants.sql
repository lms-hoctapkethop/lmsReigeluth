-- Học cùng nhau 3.8 · bất biến quyền vận hành (DB42–DB46). Chạy sau các tệp db/tests khác trên cùng DB.
-- Chỉ đọc catalog; chạy trong transaction và ROLLBACK; in 'PASS <mã>' cho từng ca.
-- Bề mặt ghi của hcn_worker được khóa bằng danh sách cho phép: mở thêm quyền cho worker = đổi đặc tả (tệp test mới), không sửa tệp này.
\set ON_ERROR_STOP 1
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok THEN RAISE NOTICE 'PASS %', label; ELSE RAISE EXCEPTION 'FAIL %', label; END IF;
END $$;

-- Quyền ghi hiệu lực (kể cả kế thừa qua membership) của một role trên mọi bảng public, ở mức bảng và mức cột.
CREATE OR REPLACE FUNCTION pg_temp.write_surface(r text) RETURNS TABLE (obj text, priv text)
LANGUAGE sql AS $$
  SELECT c.relname::text, p.priv
    FROM pg_class c
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
     AND c.relname <> 'schema_migrations'
     AND has_table_privilege(r, c.oid, p.priv)
  UNION
  SELECT c.relname || '.' || a.attname, 'UPDATE'
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
     AND c.relname <> 'schema_migrations'
     AND NOT has_table_privilege(r, c.oid, 'UPDATE')
     AND has_column_privilege(r, c.oid, a.attnum, 'UPDATE')
$$;

-- DB42 Worker phát được sự kiện dẫn xuất (ObservationsAdded) — migration 20261008000100 (M8)
SELECT pg_temp.expect_true(has_table_privilege('hcn_worker', 'outbox_events', 'INSERT'), 'DB42 worker can insert outbox_events');

-- DB43 Bề mặt ghi của worker đúng danh sách cho phép (INV-11: không ghi review, quyết định, phát hành, bài nộp, câu trả lời)
SELECT pg_temp.expect_true(
  NOT EXISTS (
    SELECT obj, priv FROM pg_temp.write_surface('hcn_worker')
    EXCEPT
    SELECT * FROM (VALUES
      ('audit_log', 'INSERT'),
      ('idempotency_keys', 'DELETE'),
      ('sessions', 'DELETE'),
      ('misconception_signals', 'INSERT'), ('misconception_signals', 'UPDATE'),
      ('needs_estimates', 'INSERT'),
      ('observations', 'INSERT'),
      ('notifications', 'INSERT'),
      ('outbox_events', 'INSERT'),
      ('outbox_events.status', 'UPDATE'), ('outbox_events.attempts', 'UPDATE'),
      ('outbox_events.available_at', 'UPDATE'), ('outbox_events.last_error', 'UPDATE'),
      ('outbox_events.processed_at', 'UPDATE'),
      ('processed_events', 'INSERT'), ('processed_events', 'UPDATE'),
      ('files.scan_status', 'UPDATE'), ('files.scanned_at', 'UPDATE')
    ) AS allow(obj, priv)),
  'DB43 worker write surface within allowlist');

-- DB44 Worker không đọc đáp án (INV-06; docs/06 mục 3.0)
SELECT pg_temp.expect_true(NOT has_table_privilege('hcn_worker', 'question_keys', 'SELECT'), 'DB44 worker cannot read question_keys');

-- DB45 Role báo cáo chỉ đọc, kể cả mức cột
SELECT pg_temp.expect_true(NOT EXISTS (SELECT 1 FROM pg_temp.write_surface('hcn_readonly')), 'DB45 hcn_readonly has no write privilege');

-- DB46 Không role ứng dụng nào được TRUNCATE (TRUNCATE bỏ qua trigger append-only)
SELECT pg_temp.expect_true(
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['hcn_app','hcn_worker','hcn_readonly']) AS r(name),
                     LATERAL pg_temp.write_surface(r.name) s WHERE s.priv = 'TRUNCATE'),
  'DB46 no application role can truncate');

ROLLBACK;
