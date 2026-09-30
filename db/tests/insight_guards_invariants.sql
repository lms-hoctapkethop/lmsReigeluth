-- Học cùng nhau 3.7 · bất biến DB38–DB41 cho migration 0009 (nền dữ liệu chẩn đoán). Chạy sau các tệp bất biến khác.
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

-- ---------------------------------------------------------------- Dữ liệu nền (giống quiz_invariants.sql)
INSERT INTO schools (id, code, name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'THPT-A', 'Trường A');
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
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', 1, 'Bài quiz', '{}', '{}', 'abc', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule) VALUES
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 0, 'quiz', 'Luyện tập', 'submit');
INSERT INTO assessment_versions (id, module_version_id, module_item_id, purpose, show_feedback, hints_enabled) VALUES
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 'practice', 'immediate', true);
INSERT INTO question_items (id, assessment_version_id, position, qtype, stem, options, bloom_target, hints, source) VALUES
  ('84000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 0, 'single_choice', '{"format":"hcn-rich/1"}'::jsonb, '[{"id":"a","label":"Đúng"}]'::jsonb, 2, '["Một","Hai","Ba"]'::jsonb, 'teacher');
INSERT INTO question_keys (question_item_id, key) VALUES
  ('84000000-0000-0000-0000-000000000001', '{"option":"a"}'::jsonb);
INSERT INTO path_releases (id, school_id, offering_id, title, created_by) VALUES
  ('85000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Đợt', '10000000-0000-0000-0000-000000000001');
INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from) VALUES
  ('86000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 0, '2026-09-01');

INSERT INTO quiz_attempts (id, school_id, learner_id, module_release_id, assessment_version_id, attempt_no) VALUES
  ('87000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1);
INSERT INTO knowledge_components (id, code, subject_code, grade) VALUES
  ('70000000-0000-0000-0000-000000000001', 'KC-TIN10-TOANTU', '1401', 10);
INSERT INTO kc_versions (id, kc_id, version_no, name, observable_criteria, status, source, reviewed_by) VALUES
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 'Toán tử', 'Tính đúng', 'superseded', 'expert', '10000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 2, 'Toán tử //, %', 'Tính đúng, kể cả số âm', 'approved', 'expert', '10000000-0000-0000-0000-000000000001');

-- DB38 points 0..1 và khớp correct; hàng cũ để NULL
INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct, points) VALUES
  ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 1, '{"option":"b"}'::jsonb, false, 0);
SELECT pg_temp.expect_true(true, 'DB38 response with points accepted');
SELECT pg_temp.expect_error($$INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct, points)
  VALUES ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 2, '{"option":"a"}'::jsonb, false, 1)$$, '23514', 'DB38b points 1 with correct false rejected');
SELECT pg_temp.expect_error($$INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct, points)
  VALUES ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 3, '{"option":"a"}'::jsonb, true, 1.2)$$, '23514', 'DB38c points above 1 rejected');
SELECT pg_temp.expect_error($$INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct, points)
  VALUES ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 4, '{"notLearned":true}'::jsonb, NULL, 0)$$, '23514', 'DB38d points without correct rejected');
INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct) VALUES
  ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 5, '{"option":"a"}'::jsonb, true);
SELECT pg_temp.expect_true(true, 'DB38e legacy row without points accepted');

-- DB39 Chỉ worker ghi quan sát, ước lượng, tín hiệu; API chỉ đọc (INV-11)
SELECT pg_temp.expect_true(
  NOT has_table_privilege('hcn_app', 'observations', 'INSERT') AND NOT has_table_privilege('hcn_app', 'needs_estimates', 'INSERT')
  AND NOT has_table_privilege('hcn_app', 'misconception_signals', 'INSERT') AND NOT has_table_privilege('hcn_app', 'misconception_signals', 'UPDATE')
  AND has_table_privilege('hcn_app', 'observations', 'SELECT') AND has_table_privilege('hcn_app', 'needs_estimates', 'SELECT'),
  'DB39 hcn_app reads but cannot write observations, needs, signals');
SELECT pg_temp.expect_true(
  has_table_privilege('hcn_worker', 'observations', 'INSERT') AND has_table_privilege('hcn_worker', 'needs_estimates', 'INSERT')
  AND has_table_privilege('hcn_worker', 'misconception_signals', 'UPDATE')
  AND NOT has_table_privilege('hcn_worker', 'attainment_decisions', 'INSERT') AND NOT has_table_privilege('hcn_worker', 'question_keys', 'SELECT'),
  'DB39b worker writes insight tables, never decisions or keys');

-- DB40 needs_estimates chỉ thêm
INSERT INTO needs_estimates (id, school_id, learner_id, offering_id, kc_version_id, status, value, n_observations, model_version, observation_ids, computed_at) VALUES
  (900001, '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'developing', 0.6, 2, 'R0@1.0.0', '{}', now() - interval '1 day');
SELECT pg_temp.expect_error($$UPDATE needs_estimates SET status = 'strong' WHERE id = 900001$$, 'append-only', 'DB40 needs estimate update blocked');
SELECT pg_temp.expect_error($$DELETE FROM needs_estimates WHERE id = 900001$$, 'append-only', 'DB40b needs estimate delete blocked');

-- DB41 needs_current_kc gộp mọi version của một KC, lấy hàng mới nhất theo model_version
INSERT INTO needs_estimates (id, school_id, learner_id, offering_id, kc_version_id, status, value, n_observations, model_version, observation_ids, computed_at) VALUES
  (900002, '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'needs_support', 0.4, 3, 'R0@1.0.0', '{}', now()),
  (900003, '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'strong', 0.9, 3, 'R0@1.1.0', '{}', now());
SELECT pg_temp.expect_true(
  (SELECT count(*) = 2 FROM needs_current_kc WHERE learner_id = '10000000-0000-0000-0000-000000000002')
  AND (SELECT id = 900002 FROM needs_current_kc WHERE model_version = 'R0@1.0.0' AND kc_id = '70000000-0000-0000-0000-000000000001'),
  'DB41 needs_current_kc one row per KC and model version, newest wins across KC versions');

ROLLBACK;
