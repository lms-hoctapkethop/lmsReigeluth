-- Kiểm thử bất biến schema Học cùng nhau 3.0
-- Chạy: psql -v ON_ERROR_STOP=1 -f db/tests/schema_invariants.sql  (trên DB đã migrate, trống)
-- Toàn bộ chạy trong một transaction và ROLLBACK ở cuối; in 'PASS <mã>' cho từng ca.

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

-- ---------------------------------------------------------------- Dữ liệu nền
INSERT INTO schools (id, code, name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'THPT-A', 'Trường A'),
  ('00000000-0000-0000-0000-00000000000b', 'THPT-B', 'Trường B');
INSERT INTO users (id, oidc_issuer, oidc_subject, display_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'https://id.test/realms/hcn', 'lan',  'GV Lan'),
  ('10000000-0000-0000-0000-000000000002', 'https://id.test/realms/hcn', 'minh', 'HS Minh'),
  ('10000000-0000-0000-0000-000000000003', 'https://id.test/realms/hcn', 'phminh', 'PH Minh');
INSERT INTO academic_years (id, school_id, code, starts_on, ends_on) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-2027', '2026-09-05', '2027-05-31'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', '2026-2027', '2026-09-05', '2027-05-31');
INSERT INTO admin_classes (id, school_id, academic_year_id, grade, code) VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 10, '10A1'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 10, '10A2');
INSERT INTO subjects (code, name, grades) VALUES ('1401', 'Tin học', '{3,4,5,6,7,8,9,10,11,12}'), ('0201', 'Toán', '{1,2,3,4,5,6,7,8,9,10,11,12}');
INSERT INTO courses (id, school_id, subject_code, grade, title) VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '1401', 10, 'Tin học 10');
INSERT INTO offerings (id, school_id, course_id, academic_year_id, term, code, title) VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 'TIN10A1-HK1', 'Tin học 10A1 HK1');

-- ---------------------------------------------------------------- Ca kiểm thử

-- DB01 Một HS không thuộc hai lớp hành chính chồng thời gian trong cùng năm học
INSERT INTO class_memberships (school_id, academic_year_id, class_id, learner_id, valid) VALUES
  ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', daterange('2026-09-05', '2026-12-01'));
SELECT pg_temp.expect_error($$INSERT INTO class_memberships (school_id, academic_year_id, class_id, learner_id, valid) VALUES
  ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', daterange('2026-11-01', '2027-05-31'))$$, '23P01', 'DB01 overlapping class membership rejected');
-- chuyển lớp liền kề hợp lệ
INSERT INTO class_memberships (school_id, academic_year_id, class_id, learner_id, valid) VALUES
  ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', daterange('2026-12-01', '2027-05-31'));
DO $$ BEGIN RAISE NOTICE 'PASS DB01b adjacent transfer accepted'; END $$;

-- DB02 Khóa ngoại ghép chặn liên kết chéo trường
SELECT pg_temp.expect_error($$INSERT INTO offering_enrollments (school_id, offering_id, learner_id) VALUES
  ('00000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')$$, '23503', 'DB02 cross-school enrollment rejected');

-- DB03 Mã 791 phải khớp môn và lớp
SELECT pg_temp.expect_error($$INSERT INTO curriculum_requirements (code791_stem, bloom_level, subject_code, grade, unit1, unit2, text, source_doc)
  VALUES ('140110.0601a', 6, '1401', 11, '06', '01', 'x', 'test')$$, '23514', 'DB03 code791 grade mismatch rejected');
INSERT INTO curriculum_requirements (id, code791_stem, bloom_level, subject_code, grade, unit1, unit2, text, source_doc) VALUES
  ('60000000-0000-0000-0000-000000000001', '140110.0601a', 6, '1401', 10, '06', '01', 'Viết và thực hiện được một vài chương trình…', 'QD791_PL22_TinHoc');

-- DB04 Đồ thị tiên quyết đã duyệt không có chu trình
INSERT INTO knowledge_components (id, code, subject_code, grade) VALUES
  ('70000000-0000-0000-0000-000000000001', 'KC-TIN10-TOANTU', '1401', 10),
  ('70000000-0000-0000-0000-000000000002', 'KC-TIN10-IF', '1401', 10),
  ('70000000-0000-0000-0000-000000000003', 'KC-TIN10-FOR', '1401', 10);
INSERT INTO kc_versions (id, kc_id, version_no, name, observable_criteria, status, source, reviewed_by) VALUES
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 'Toán tử // và %', 'Tính đúng kết quả', 'approved', 'expert', '10000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 1, 'Rẽ nhánh if–else', 'Chọn đúng nhánh', 'approved', 'expert', '10000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', 1, 'Vòng lặp for', 'Liệt kê đúng giá trị lặp', 'approved', 'expert', '10000000-0000-0000-0000-000000000001');
INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source) VALUES
  ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'prerequisite', 'approved', 'expert'),
  ('71000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000003', 'prerequisite', 'approved', 'expert');
SELECT pg_temp.expect_error($$INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source) VALUES
  ('71000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', 'prerequisite', 'approved', 'expert')$$, 'KC_EDGE_CYCLE', 'DB04 cycle rejected');
-- cạnh vòng ở trạng thái đề xuất được phép lưu (chưa dùng cho chẩn đoán)
INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source) VALUES
  ('71000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', 'prerequisite', 'proposed', 'ai_proposal');
SELECT pg_temp.expect_error($$UPDATE kc_edges SET status = 'approved' WHERE from_kc_version_id = '71000000-0000-0000-0000-000000000003'$$, 'KC_EDGE_CYCLE', 'DB04b approving a cyclic proposed edge rejected');

-- DB05 Nội dung KC version bất biến; trạng thái duyệt đổi được
SELECT pg_temp.expect_error($$UPDATE kc_versions SET name = 'đổi' WHERE id = '71000000-0000-0000-0000-000000000001'$$, 'immutable', 'DB05 kc_version content immutable');

-- DB06 Module version và mục bất biến; completion hợp lệ theo loại mục
INSERT INTO modules (id, school_id, course_id, owner_id) VALUES
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_versions (id, school_id, module_id, version_no, title, requirement_ids, coverage_report, digest, published_by) VALUES
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', 1, 'Lập trình cơ bản',
   ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], '{"warnings":[]}', repeat('a', 64), '10000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error($$UPDATE module_versions SET title = 'x' WHERE id = '81000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB06 module_version immutable');
SELECT pg_temp.expect_error($$INSERT INTO module_items (module_version_id, position, item_type, title, completion_rule)
  VALUES ('81000000-0000-0000-0000-000000000001', 0, 'header', 'Mục tiêu', 'submit')$$, '23514', 'DB06b header with submit rejected');
INSERT INTO rubric_versions (id, module_version_id, title) VALUES ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Rubric tiền điện');
INSERT INTO rubric_criteria (id, rubric_version_id, position, title, kc_version_id, level_meets, level_developing, level_not_yet) VALUES
  ('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 0, 'Rẽ nhánh theo bậc giá', '71000000-0000-0000-0000-000000000002', 'Đúng mọi bậc', 'Sai ngưỡng', 'Sai logic');
INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule, rubric_version_id) VALUES
  ('84000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 0, 'assignment', 'Chương trình tính tiền điện', 'submit', '82000000-0000-0000-0000-000000000001'),
  ('84000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', 1, 'quiz', 'Luyện tập', 'submit', NULL);

-- DB07 Câu AI soạn phải có người duyệt (V07); gợi ý chỉ cho practice
INSERT INTO assessment_versions (id, module_version_id, module_item_id, purpose, show_feedback, hints_enabled) VALUES
  ('85000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000002', 'practice', 'immediate', true);
SELECT pg_temp.expect_error($$INSERT INTO question_items (assessment_version_id, position, qtype, stem, options, bloom_target, source)
  VALUES ('85000000-0000-0000-0000-000000000001', 0, 'single_choice', '{"text":"7 // 2 = ?"}', '[{"id":"a"},{"id":"b"}]', 3, 'ai_proposal')$$, '23514', 'DB07 unapproved AI question rejected');
INSERT INTO question_items (id, assessment_version_id, position, qtype, stem, options, bloom_target, source, hints) VALUES
  ('86000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', 0, 'single_choice', '{"text":"print(7 // 2)"}',
   '[{"id":"a","label":"3.5"},{"id":"b","label":"3"}]', 3, 'teacher', '["// khác / ở đâu?","// bỏ phần thập phân"]');
INSERT INTO question_keys (question_item_id, key) VALUES ('86000000-0000-0000-0000-000000000001', '{"option":"b"}');

-- DB08 Giao bài, bài nộp, phiên bản bất biến
INSERT INTO path_releases (id, school_id, offering_id, title, created_by) VALUES
  ('87000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Tuần 5', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from, due_at) VALUES
  ('88000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '87000000-0000-0000-0000-000000000001',
   '81000000-0000-0000-0000-000000000001', 0, '2026-10-05T00:00:00Z', '2026-10-09T16:59:00Z');
INSERT INTO submissions (id, school_id, learner_id, module_release_id, module_item_id, status, current_version_no) VALUES
  ('89000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '88000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 'submitted', 1);
SELECT pg_temp.expect_error($$INSERT INTO submissions (school_id, learner_id, module_release_id, module_item_id) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '88000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001')$$, '23505', 'DB08 one submission per learner/release/item');
INSERT INTO submission_versions (id, submission_id, version_no, body, content_hash) VALUES
  ('8a000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000001', 1, '{"type":"code","language":"python","text":"if so_dien <= 50: ..."}', repeat('b', 64));
SELECT pg_temp.expect_error($$UPDATE submission_versions SET body = '{}' WHERE id = '8a000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB08b submission_version immutable');

-- DB09 Quyết định mức đạt cần review đã công bố (kiểm ở commit)
INSERT INTO reviews (id, school_id, submission_id, submission_version_id, rubric_version_id, reviewer_id, status) VALUES
  ('8b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '89000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'draft');
SELECT pg_temp.expect_error($$
  SET CONSTRAINTS attainment_requires_published_review IMMEDIATE;
  INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'achieved', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  'ATTAINMENT_REQUIRES_PUBLISHED_REVIEW', 'DB09 attainment on draft review rejected');
SET CONSTRAINTS attainment_requires_published_review DEFERRED;
UPDATE reviews SET status = 'published', published_at = now(), outcome = 'reviewed' WHERE id = '8b000000-0000-0000-0000-000000000001';
INSERT INTO attainment_decisions (id, school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by) VALUES
  ('8c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'not_yet', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
SET CONSTRAINTS attainment_requires_published_review IMMEDIATE;
DO $$ BEGIN RAISE NOTICE 'PASS DB09b attainment on published review accepted'; END $$;

-- DB10 Review đã công bố bất biến
SELECT pg_temp.expect_error($$UPDATE reviews SET comment = 'sửa' WHERE id = '8b000000-0000-0000-0000-000000000001'$$, 'immutable', 'DB10 published review immutable');

-- DB11 Chuỗi thay thế quyết định tuyến tính; thay thế cần lý do
SELECT pg_temp.expect_error($$INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by, supersedes_id) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'achieved', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001')$$,
  '23514', 'DB11 supersede without reason rejected');
INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by, supersedes_id, reason) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'achieved', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001', 'Chấm lại v1');
SELECT pg_temp.expect_error($$INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by, supersedes_id, reason) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'not_yet', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001', 'nhánh thứ hai')$$,
  '23505', 'DB11b decision superseded twice rejected');
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM attainment_current WHERE learner_id = '10000000-0000-0000-0000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL DB11c expected 1 current decision, got %', n; END IF;
  RAISE NOTICE 'PASS DB11c exactly one current decision';
END $$;

-- DB12 Quan sát idempotent theo nguồn (B02) và bất biến
INSERT INTO observations (school_id, learner_id, offering_id, kc_version_id, source_type, source_ref, weight, score, observed_at) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
   'review', 'review_criterion:8b000000-0000-0000-0000-000000000001:83000000-0000-0000-0000-000000000001', 1, 0.5, now());
SELECT pg_temp.expect_error($$INSERT INTO observations (school_id, learner_id, offering_id, kc_version_id, source_type, source_ref, weight, score, observed_at) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
   'review', 'review_criterion:8b000000-0000-0000-0000-000000000001:83000000-0000-0000-0000-000000000001', 1, 0.5, now())$$, '23505', 'DB12 duplicate observation rejected');

-- DB13 Thông báo không trùng khi worker chạy lại (A08)
INSERT INTO notifications (school_id, recipient_id, kind, payload, source_event) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'review_published', '{}', '90000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error($$INSERT INTO notifications (school_id, recipient_id, kind, payload, source_event) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'review_published', '{}', '90000000-0000-0000-0000-000000000001')$$, '23505', 'DB13 duplicate notification rejected');

-- DB14 Liên kết PH: không hai liên kết hiệu lực cho cùng cặp; verified cần người xác minh
SELECT pg_temp.expect_error($$INSERT INTO guardian_links (school_id, guardian_id, learner_id, status) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'verified')$$, '23514', 'DB14 verified link without verifier rejected');
INSERT INTO guardian_links (school_id, guardian_id, learner_id, status) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'pending');
SELECT pg_temp.expect_error($$INSERT INTO guardian_links (school_id, guardian_id, learner_id, status) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'pending')$$, '23505', 'DB14b duplicate active link rejected');

-- DB15 Worker không đọc khóa đáp án và không ghi quyết định (INV-11)
SET LOCAL ROLE hcn_worker;
SELECT pg_temp.expect_error($$SELECT key FROM question_keys$$, '42501', 'DB15 worker cannot read question_keys');
SELECT pg_temp.expect_error($$INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'achieved', '8b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  '42501', 'DB15b worker cannot write attainment_decisions');
SELECT pg_temp.expect_error($$UPDATE module_releases SET due_at = now() + interval '1 day'$$, '42501', 'DB15c worker cannot change releases');
RESET ROLE;

-- DB16 Tệp vượt 25 MiB bị từ chối
SELECT pg_temp.expect_error($$INSERT INTO files (school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name) VALUES
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'k1', repeat('c', 64), 26214401, 'application/pdf', 'a.pdf')$$, '23514', 'DB16 oversize file rejected');

ROLLBACK;
