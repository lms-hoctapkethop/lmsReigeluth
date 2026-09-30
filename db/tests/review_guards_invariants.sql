-- Học cùng nhau 3.6 · bất biến DB33–DB37 cho migration 0008 (chấm bài, quyết định, gia đình, thông báo). Chạy sau các tệp bất biến khác.
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
INSERT INTO schools (id, code, name) VALUES ('00000000-0000-0000-0000-00000000000a', 'THPT-A', 'Trường A');
INSERT INTO users (id, oidc_issuer, oidc_subject, display_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'https://id.test/realms/hcn', 'lan',    'GV Lan'),
  ('10000000-0000-0000-0000-000000000002', 'https://id.test/realms/hcn', 'minh',   'HS Minh'),
  ('10000000-0000-0000-0000-000000000003', 'https://id.test/realms/hcn', 'phminh', 'PH Minh'),
  ('10000000-0000-0000-0000-000000000004', 'https://id.test/realms/hcn', 'an',     'HS An');
INSERT INTO academic_years (id, school_id, code, starts_on, ends_on) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-2027', '2026-09-05', '2027-05-31');
INSERT INTO subjects (code, name, grades) VALUES ('1401', 'Tin học', '{10}');
INSERT INTO courses (id, school_id, subject_code, grade, title) VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '1401', 10, 'Tin học 10');
INSERT INTO offerings (id, school_id, course_id, academic_year_id, term, code, title) VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 'TIN10A1', 'Tin 10A1'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 'TIN10A2', 'Tin 10A2');
INSERT INTO curriculum_requirements (id, code791_stem, bloom_level, subject_code, grade, unit1, unit2, text, source_doc) VALUES
  ('60000000-0000-0000-0000-000000000001', '140110.0601a', 6, '1401', 10, '06', '01', 'Viết và thực hiện được một vài chương trình…', 'QD791_PL22_TinHoc'),
  ('60000000-0000-0000-0000-000000000002', '140110.0603b', 4, '1401', 10, '06', '03', 'Kiểm thử và gỡ lỗi được chương trình.', 'QD791_PL22_TinHoc');
INSERT INTO modules (id, school_id, course_id, owner_id) VALUES
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_versions (id, school_id, module_id, version_no, title, requirement_ids, coverage_report, digest, published_by) VALUES
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', 1, 'Bài 1',
   ARRAY['60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002']::uuid[], '{}', repeat('a', 64), '10000000-0000-0000-0000-000000000001');
INSERT INTO rubric_versions (id, module_version_id, title) VALUES ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Rubric');
INSERT INTO rubric_criteria (id, rubric_version_id, position, title, level_meets, level_developing, level_not_yet) VALUES
  ('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 0, 'Rẽ nhánh', 'Đạt', 'Đang', 'Chưa'),
  ('83000000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000001', 1, 'Kiểm thử', 'Đạt', 'Đang', 'Chưa');
INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule, rubric_version_id) VALUES
  ('84000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 0, 'assignment', 'Tiền điện', 'submit', '82000000-0000-0000-0000-000000000001');
INSERT INTO path_releases (id, school_id, offering_id, title, created_by) VALUES
  ('87000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Tuần 5', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from, due_at) VALUES
  ('88000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '87000000-0000-0000-0000-000000000001',
   '81000000-0000-0000-0000-000000000001', 0, '2026-10-05T00:00:00Z', '2026-10-09T16:59:00Z');
INSERT INTO submissions (id, school_id, learner_id, module_release_id, module_item_id, status, current_version_no) VALUES
  ('89000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '88000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 'submitted', 1),
  ('89000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000004', '88000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 'submitted', 1);
INSERT INTO submission_versions (id, submission_id, version_no, body, content_hash) VALUES
  ('8a000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000001', 1, '{"type":"text","text":"minh"}', repeat('b', 64)),
  ('8a000000-0000-0000-0000-000000000002', '89000000-0000-0000-0000-000000000002', 1, '{"type":"text","text":"an"}', repeat('c', 64));
INSERT INTO reviews (id, school_id, submission_id, submission_version_id, rubric_version_id, reviewer_id, status) VALUES
  ('8b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '89000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'draft'),
  ('8b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '89000000-0000-0000-0000-000000000002', '8a000000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'draft');
INSERT INTO review_criterion_results (review_id, rubric_criterion_id, level) VALUES
  ('8b000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 'meets'),
  ('8b000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002', 'developing');
UPDATE reviews SET status = 'published', published_at = now(), outcome = 'reviewed' WHERE id IN ('8b000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000002');

-- DB33 Kết quả tiêu chí của review đã công bố bất biến
SELECT pg_temp.expect_error($$UPDATE review_criterion_results SET level = 'meets' WHERE review_id = '8b000000-0000-0000-0000-000000000001' AND rubric_criterion_id = '83000000-0000-0000-0000-000000000002'$$, 'REVIEW_PUBLISHED', 'DB33 published criterion result update blocked');
SELECT pg_temp.expect_error($$INSERT INTO review_criterion_results (review_id, rubric_criterion_id, level) VALUES ('8b000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000001', 'meets')$$, 'REVIEW_PUBLISHED', 'DB33b insert into published review blocked');
SELECT pg_temp.expect_error($$DELETE FROM review_criterion_results WHERE review_id = '8b000000-0000-0000-0000-000000000001'$$, 'REVIEW_PUBLISHED', 'DB33c delete from published review blocked');

-- DB34 Quyết định chỉ dựa trên review của chính HS, đúng offering
SELECT pg_temp.expect_error($$INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'achieved', '8b000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$$,
  'ATTAINMENT_REVIEW_MISMATCH', 'DB34 decision on another learner''s review rejected');
SELECT pg_temp.expect_error($$INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'achieved', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  'ATTAINMENT_REVIEW_MISMATCH', 'DB34b decision in another offering rejected');

-- DB35 Một quyết định gốc cho mỗi (HS, offering, YCCĐ); chuỗi thay thế không đổi đối tượng
INSERT INTO attainment_decisions (id, school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by) VALUES
  ('8c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'not_yet', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_true(true, 'DB35 first root decision accepted');
SELECT pg_temp.expect_error($$INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'achieved', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  '23505', 'DB35b second root for same learner/offering/requirement rejected');
SELECT pg_temp.expect_error($$INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by, supersedes_id, reason) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'achieved', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001', 'đổi YCCĐ')$$,
  'ATTAINMENT_CHAIN_MISMATCH', 'DB35c supersede across requirements rejected');

-- DB36 Đồng hành gia đình: chỉ committed → cancelled, nội dung bất biến
INSERT INTO guardian_links (id, school_id, guardian_id, learner_id, status, verified_by, verified_at) VALUES
  ('8d000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'verified', '10000000-0000-0000-0000-000000000001', now());
INSERT INTO family_supports (id, school_id, guardian_link_id, offering_id, content) VALUES
  ('8e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '8d000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Nhắc con tự kiểm thử ở giá trị ngưỡng');
SELECT pg_temp.expect_error($$UPDATE family_supports SET content = 'sửa' WHERE id = '8e000000-0000-0000-0000-000000000001'$$, 'committed -> cancelled', 'DB36 content change rejected');
SELECT pg_temp.expect_error($$DELETE FROM family_supports WHERE id = '8e000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB36b delete rejected');
UPDATE family_supports SET status = 'cancelled', cancelled_at = now() WHERE id = '8e000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($$UPDATE family_supports SET status = 'committed', cancelled_at = NULL WHERE id = '8e000000-0000-0000-0000-000000000001'$$, 'committed -> cancelled', 'DB36c cancelled cannot be recommitted');

-- DB37 Thông báo: hcn_app chỉ đổi read_at, không xóa
SELECT pg_temp.expect_true(has_column_privilege('hcn_app', 'notifications', 'read_at', 'UPDATE')
  AND NOT has_column_privilege('hcn_app', 'notifications', 'payload', 'UPDATE')
  AND NOT has_table_privilege('hcn_app', 'notifications', 'DELETE'), 'DB37 hcn_app updates notifications.read_at only');
SELECT pg_temp.expect_true(has_table_privilege('hcn_worker', 'notifications', 'INSERT'), 'DB37b worker inserts notifications');

ROLLBACK;
