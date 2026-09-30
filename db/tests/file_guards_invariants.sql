-- Học cùng nhau 3.5 · bất biến DB30–DB32 cho migration 0007 (chốt chặn tệp). Chạy sau các tệp bất biến khác trên cùng DB.
-- Tự dựng dữ liệu nền, chạy trong một transaction và ROLLBACK ở cuối; in 'PASS <mã>' cho từng ca.
\set ON_ERROR_STOP 1
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(stmt text, needle text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(needle IN SQLERRM) > 0 OR SQLSTATE = needle THEN
      RAISE NOTICE 'PASS %', label; RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL % (wrong error: % %)', label, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL % (no error)', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok THEN RAISE NOTICE 'PASS %', label; ELSE RAISE EXCEPTION 'FAIL %', label; END IF;
END $$;

-- ---------------------------------------------------------------- Dữ liệu nền
INSERT INTO schools (id, code, name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'THPT-A', 'Trường A'),
  ('00000000-0000-0000-0000-00000000000b', 'THPT-B', 'Trường B');
INSERT INTO users (id, oidc_issuer, oidc_subject, display_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'https://id.test/realms/hcn', 'lan',  'GV Lan'),
  ('10000000-0000-0000-0000-000000000002', 'https://id.test/realms/hcn', 'minh', 'HS Minh'),
  ('10000000-0000-0000-0000-000000000004', 'https://id.test/realms/hcn', 'an',   'HS An');
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
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', 1, 'Bài 1', '{}', '{}', repeat('a', 64), '10000000-0000-0000-0000-000000000001');
INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule, submission_config) VALUES
  ('84000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 0, 'assignment', 'Nhiệm vụ', 'submit', '{"types":["text"],"allowFiles":true,"maxFiles":5}');
INSERT INTO path_releases (id, school_id, offering_id, title, created_by) VALUES
  ('87000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Tuần 5', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from, due_at) VALUES
  ('88000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '87000000-0000-0000-0000-000000000001',
   '81000000-0000-0000-0000-000000000001', 0, '2026-10-05T00:00:00Z', '2026-10-09T16:59:00Z');
INSERT INTO submissions (id, school_id, learner_id, module_release_id, module_item_id, status, current_version_no) VALUES
  ('89000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '88000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 'submitted', 1);
INSERT INTO submission_versions (id, submission_id, version_no, body, content_hash) VALUES
  ('8a000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000001', 1, '{"type":"text","text":"x"}', repeat('b', 64));
INSERT INTO files (id, school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name, scan_status) VALUES
  ('8b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'a/1', repeat('c', 64), 10, 'application/pdf', 'bai.pdf', 'clean'),
  ('8b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'a/2', repeat('d', 64), 10, 'application/pdf', 'cho.pdf', 'pending'),
  ('8b000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000004', 'a/3', repeat('e', 64), 10, 'application/pdf', 'cuaban.pdf', 'clean'),
  ('8b000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'a/4', repeat('f', 64), 10, 'application/pdf', 'virus.pdf', 'infected'),
  ('8b000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'a/5', repeat('0', 64), 10, 'image/png', 'hinh.png', 'clean'),
  ('8b000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'a/6', repeat('1', 64), 10, 'image/png', 'cho.png', 'pending');

-- DB30 Tệp gắn bài nộp: đúng chủ, cùng trường, đã quét sạch
INSERT INTO submission_version_files (submission_version_id, file_id) VALUES ('8a000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_true(true, 'DB30 own clean file attached');
SELECT pg_temp.expect_error($$INSERT INTO submission_version_files (submission_version_id, file_id) VALUES ('8a000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000002')$$, 'SUBMISSION_FILE_INVALID', 'DB30b pending file rejected');
SELECT pg_temp.expect_error($$INSERT INTO submission_version_files (submission_version_id, file_id) VALUES ('8a000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000003')$$, 'SUBMISSION_FILE_INVALID', 'DB30c another learner''s file rejected');
SELECT pg_temp.expect_error($$INSERT INTO submission_version_files (submission_version_id, file_id) VALUES ('8a000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000004')$$, 'SUBMISSION_FILE_INVALID', 'DB30d infected file rejected');

-- DB31 Ảnh nội dung: chỉ ảnh clean
INSERT INTO content_files (id, school_id, module_version_id, module_item_id, file_id, alt) VALUES
  ('8c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000005', 'Sơ đồ bậc giá');
SELECT pg_temp.expect_true(true, 'DB31 clean image linked');
SELECT pg_temp.expect_error($$INSERT INTO content_files (school_id, module_version_id, module_item_id, file_id, alt) VALUES
  ('00000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000001', 'pdf')$$, 'CONTENT_FILE_INVALID', 'DB31b non-image rejected');
SELECT pg_temp.expect_error($$INSERT INTO content_files (school_id, module_version_id, module_item_id, file_id, alt) VALUES
  ('00000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000006', 'chưa quét')$$, 'CONTENT_FILE_INVALID', 'DB31c unscanned image rejected');

-- DB32 content_files bất biến; hcn_app chỉ SELECT, INSERT
SELECT pg_temp.expect_error($$UPDATE content_files SET alt = 'x' WHERE id = '8c000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB32 content_files update blocked');
SELECT pg_temp.expect_error($$DELETE FROM content_files WHERE id = '8c000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB32b content_files delete blocked');
SELECT pg_temp.expect_true(has_table_privilege('hcn_app', 'content_files', 'INSERT')
  AND NOT has_table_privilege('hcn_app', 'content_files', 'UPDATE')
  AND NOT has_table_privilege('hcn_app', 'content_files', 'DELETE'), 'DB32c hcn_app inserts content_files only');

ROLLBACK;
