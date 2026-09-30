-- Bất biến M5: submission_config, content_files, lịch giao, tệp, bài nộp.
-- Chạy sau migration, trong transaction rồi ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(sql text, code text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF code IS NULL OR SQLSTATE = code OR SQLERRM LIKE '%' || code || '%' THEN
      RAISE NOTICE 'PASS %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL % : got % %', label, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL % : no error raised', label;
END $$;

INSERT INTO schools (id, code, name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'THPT-A', 'Trường A'),
  ('00000000-0000-0000-0000-00000000000b', 'THPT-B', 'Trường B');
INSERT INTO users (id, oidc_issuer, oidc_subject, display_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'https://id.test/realms/hcn', 'lan', 'GV Lan'),
  ('10000000-0000-0000-0000-000000000002', 'https://id.test/realms/hcn', 'minh', 'HS Minh');
INSERT INTO academic_years (id, school_id, code, starts_on, ends_on) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-2027', '2026-09-05', '2027-05-31');
INSERT INTO subjects (code, name, grades) VALUES ('1401', 'Tin học', '{10}');
INSERT INTO courses (id, school_id, subject_code, grade, title) VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '1401', 10, 'Tin học 10');
INSERT INTO offerings (id, school_id, course_id, academic_year_id, term, code, title) VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 'TIN10A1', 'Tin học 10A1');
INSERT INTO modules (id, school_id, course_id, owner_id) VALUES
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_versions (id, school_id, module_id, version_no, title, requirement_ids, coverage_report, digest, published_by) VALUES
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', 1, 'Bài 1', '{}', '{}', 'abc', '10000000-0000-0000-0000-000000000001');

-- DB22 submission_config đúng CHECK
SELECT pg_temp.expect_error($$INSERT INTO module_items (module_version_id, position, item_type, title, completion_rule, submission_config)
  VALUES ('81000000-0000-0000-0000-000000000001', 0, 'assignment', 'Sai', 'submit', '{"types":["exe"]}'::jsonb)$$, '23514', 'DB22 loại nộp không hợp lệ bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO module_items (module_version_id, position, item_type, title, completion_rule, submission_config)
  VALUES ('81000000-0000-0000-0000-000000000001', 1, 'page', 'Trang', 'view', '{"types":["text"]}'::jsonb)$$, '23514', 'DB22b cấu hình nộp trên trang bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO module_items (module_version_id, position, item_type, title, completion_rule, submission_config)
  VALUES ('81000000-0000-0000-0000-000000000001', 2, 'assignment', 'Thừa', 'submit', '{"types":["text"],"extra":true}'::jsonb)$$, '23514', 'DB22c khóa lạ bị từ chối');
INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule, submission_config) VALUES
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 3, 'assignment', 'Nhiệm vụ', 'submit', '{"types":["text","code"],"allowFiles":true,"maxFiles":3}'::jsonb);
DO $$ BEGIN RAISE NOTICE 'PASS DB22d cấu hình nộp hợp lệ được ghi'; END $$;

-- DB23 content_files
INSERT INTO files (id, school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name, scan_status) VALUES
  ('83000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'a/2026/09/one', repeat('a', 64), 12, 'image/png', 'anh.png', 'clean'),
  ('83000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'b/2026/09/two', repeat('b', 64), 12, 'image/png', 'khac.png', 'clean');
SELECT pg_temp.expect_error($$INSERT INTO content_files (school_id, module_version_id, module_item_id, file_id, alt)
  VALUES ('00000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '')$$, '23514', 'DB23 alt rỗng bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO content_files (school_id, module_version_id, module_item_id, file_id, alt)
  VALUES ('00000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', repeat('a', 301))$$, '23514', 'DB23b alt dài hơn 300 bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO content_files (school_id, module_version_id, module_item_id, file_id, alt)
  VALUES ('00000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002', 'ảnh')$$, '23503', 'DB23c tệp khác trường bị từ chối');
INSERT INTO content_files (school_id, module_version_id, module_item_id, file_id, alt) VALUES
  ('00000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 'Sơ đồ');
DO $$ BEGIN RAISE NOTICE 'PASS DB23d ảnh học liệu hợp lệ được ghi'; END $$;
DO $$ BEGIN
  IF NOT has_table_privilege('hcn_app', 'content_files', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL DB23e missing grant';
  END IF;
  RAISE NOTICE 'PASS DB23e hcn_app được ghi content_files';
END $$;

-- DB24 lịch giao
SELECT pg_temp.expect_error($$INSERT INTO path_releases (id, school_id, offering_id, title, created_by) VALUES
  ('84000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Đợt', '10000000-0000-0000-0000-000000000001');
  INSERT INTO module_releases (school_id, offering_id, path_release_id, module_version_id, position, available_from, due_at)
  VALUES ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 0, '2026-09-01', '2026-09-01')$$, '23514', 'DB24 hạn không sau giờ mở bị từ chối');
INSERT INTO path_releases (id, school_id, offering_id, title, created_by) VALUES
  ('84000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Đợt hợp lệ', '10000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error($$INSERT INTO module_releases (school_id, offering_id, path_release_id, module_version_id, position, available_from, due_at, accept_until)
  VALUES ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', 0, '2026-09-01', '2026-09-10', '2026-09-09')$$, '23514', 'DB24b nhận bài trước hạn bị từ chối');
INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from, due_at, accept_until) VALUES
  ('85000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', 0, '2026-09-01', '2026-09-10', '2026-09-12');
DO $$ BEGIN RAISE NOTICE 'PASS DB24c lịch hợp lệ được ghi'; END $$;

-- DB25 tệp
SELECT pg_temp.expect_error($$INSERT INTO files (school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'a/zero', repeat('c', 64), 0, 'text/plain', 'rong.txt')$$, '23514', 'DB25 tệp rỗng bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO files (school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'a/big', repeat('d', 64), 26214401, 'text/plain', 'lon.txt')$$, '23514', 'DB25b tệp quá 25 MiB bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO files (school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name, scan_status)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'a/bad', repeat('e', 64), 4, 'text/plain', 'x.txt', 'virus')$$, '23514', 'DB25c trạng thái quét lạ bị từ chối');

-- DB26 bài nộp
INSERT INTO submissions (id, school_id, learner_id, module_release_id, module_item_id) VALUES
  ('86000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '85000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error($$INSERT INTO submissions (school_id, learner_id, module_release_id, module_item_id)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '85000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001')$$, '23505', 'DB26 trùng bài nộp của cùng HS bị từ chối');
INSERT INTO submission_versions (id, submission_id, version_no, body, content_hash) VALUES
  ('87000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001', 1, '{"type":"text","text":"v1"}'::jsonb, repeat('f', 64));
SELECT pg_temp.expect_error($$UPDATE submission_versions SET body = '{}'::jsonb WHERE id = '87000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB26b phiên bản bài nộp không sửa được');
SELECT pg_temp.expect_error($$INSERT INTO submission_versions (submission_id, version_no, body, content_hash)
  VALUES ('86000000-0000-0000-0000-000000000001', 0, '{}'::jsonb, repeat('1', 64))$$, '23514', 'DB26c version_no 0 bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO activity_progress (school_id, learner_id, module_release_id, module_item_id, status, completion_rule, source_event)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '85000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 'completed', 'submit', 'submission:x')$$, '23514', 'DB26d hoàn thành thiếu thời điểm bị từ chối');
DO $$ BEGIN
  IF NOT has_table_privilege('hcn_worker', 'idempotency_keys', 'DELETE')
     OR NOT has_table_privilege('hcn_worker', 'sessions', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL DB26e missing cleanup grant';
  END IF;
  RAISE NOTICE 'PASS DB26e worker được dọn idempotency và phiên';
END $$;

ROLLBACK;
