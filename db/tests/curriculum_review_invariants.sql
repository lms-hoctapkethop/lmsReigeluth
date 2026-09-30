-- Học cùng nhau 3.1 · bất biến M3 (DB17–DB20). Chạy sau schema_invariants.sql trên cùng DB.
-- Tự dựng dữ liệu nền (giống DB04), chạy trong một transaction và ROLLBACK ở cuối; in 'PASS <mã>' cho từng ca.
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

INSERT INTO users (id, oidc_issuer, oidc_subject, display_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'https://id.test/realms/hcn', 'reviewer', 'Người duyệt');
INSERT INTO subjects (code, name, grades) VALUES ('1401', 'Tin học', '{3,4,5,6,7,8,9,10,11,12}');
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

-- DB17 Nhật ký duyệt append-only; old_text/new_text đi cặp và chỉ cho YCCĐ
INSERT INTO curriculum_review_log (id, object_type, object_id, from_status, to_status, note, reviewed_by)
VALUES ('90000000-0000-0000-0000-000000000001', 'kc_version', '71000000-0000-0000-0000-000000000001', 'proposed', 'approved', 'ok',
        '10000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error($$UPDATE curriculum_review_log SET note = 'x' WHERE id = '90000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB17 review log immutable');
SELECT pg_temp.expect_error($$INSERT INTO curriculum_review_log (object_type, object_id, to_status, old_text, new_text, reviewed_by)
  VALUES ('kc_edge', gen_random_uuid(), 'approved', 'a', 'b', '10000000-0000-0000-0000-000000000001')$$, '23514', 'DB17b text correction only for requirement');

-- DB18 Thay version: v2 của KC-TIN10-IF được duyệt, v1 superseded; cạnh cũ không còn trong đồ thị hiệu lực
INSERT INTO kc_versions (id, kc_id, version_no, name, observable_criteria, status, source, reviewed_by) VALUES
  ('71000000-0000-0000-0000-000000000012', '70000000-0000-0000-0000-000000000002', 2, 'Rẽ nhánh if–elif–else', 'Chọn đúng nhánh, kể cả elif', 'approved', 'expert', '10000000-0000-0000-0000-000000000001');
UPDATE kc_versions SET status = 'superseded' WHERE id = '71000000-0000-0000-0000-000000000002';
SELECT pg_temp.expect_true(
  NOT EXISTS (SELECT 1 FROM effective_kc_edges WHERE from_kc_version_id = '71000000-0000-0000-0000-000000000002' OR to_kc_version_id = '71000000-0000-0000-0000-000000000002'),
  'DB18 superseded version leaves effective graph');
-- Chuyển cạnh sang v2 (việc của use case reviewKcVersion)
INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source, rationale) VALUES
  ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000012', 'prerequisite', 'approved', 'expert', 'carried from v1'),
  ('71000000-0000-0000-0000-000000000012', '71000000-0000-0000-0000-000000000003', 'prerequisite', 'approved', 'expert', 'carried from v1');
SELECT pg_temp.expect_true((SELECT count(*) = 2 FROM effective_kc_edges), 'DB18b effective graph uses v2 edges only');

-- DB19 Chu trình qua version mới vẫn bị chặn
SELECT pg_temp.expect_error($$INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source)
  VALUES ('71000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', 'develops_into', 'approved', 'expert')$$, 'KC_EDGE_CYCLE', 'DB19 cycle through new version rejected');

-- DB20 Cạnh lịch sử chạm version superseded không gây báo chu trình giả.
-- Giả sử khi duyệt v2, người duyệt bỏ quan hệ IF v2 -> FOR. Khi đó FOR -> TOANTU không tạo vòng thật,
-- nhưng trigger cũ vẫn chặn vì còn đường lịch sử TOANTU -> IF v1 -> FOR qua version đã superseded.
DELETE FROM kc_edges WHERE from_kc_version_id = '71000000-0000-0000-0000-000000000012' AND to_kc_version_id = '71000000-0000-0000-0000-000000000003';
INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source, rationale) VALUES
  ('71000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', 'develops_into', 'approved', 'expert', 'DB20');
SELECT pg_temp.expect_true(true, 'DB20 edge via superseded history accepted');

-- DB21 Cấp quyền cho bảng mới
SELECT pg_temp.expect_true(has_table_privilege('hcn_app', 'curriculum_review_log', 'INSERT'), 'DB21 hcn_app can insert review log');
SELECT pg_temp.expect_true(NOT has_table_privilege('hcn_app', 'curriculum_review_log', 'UPDATE'), 'DB21b hcn_app cannot update review log');
SELECT pg_temp.expect_true(NOT has_table_privilege('hcn_worker', 'curriculum_review_log', 'INSERT'), 'DB21c worker cannot write review log');
SELECT pg_temp.expect_true(
  NOT EXISTS (SELECT 1 FROM pg_class c
               WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v')
                 AND c.relname <> 'schema_migrations'
                 AND NOT has_table_privilege('hcn_app', c.oid, 'SELECT')),
  'DB21d every table readable by hcn_app');

ROLLBACK;
