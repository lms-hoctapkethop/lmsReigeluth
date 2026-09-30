-- Bất biến M6: lượt quiz, câu trả lời append-only, gợi ý và khóa đáp án.
-- Chạy sau migration, trong transaction rồi ROLLBACK. Không sửa tệp bất biến đã có.

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

-- DB27 lượt làm
SELECT pg_temp.expect_error($$INSERT INTO quiz_attempts (school_id, learner_id, module_release_id, assessment_version_id, attempt_no)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 0)$$, '23514', 'DB27 attempt_no 0 bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO quiz_attempts (school_id, learner_id, module_release_id, assessment_version_id, attempt_no, status)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1, 'draft')$$, '23514', 'DB27b trạng thái lạ bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO quiz_attempts (school_id, learner_id, module_release_id, assessment_version_id, attempt_no, status)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1, 'submitted')$$, '23514', 'DB27c nộp thiếu submitted_at bị từ chối');
INSERT INTO quiz_attempts (id, school_id, learner_id, module_release_id, assessment_version_id, attempt_no) VALUES
  ('87000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1);
DO $$ BEGIN RAISE NOTICE 'PASS DB27d lượt đang làm hợp lệ được ghi'; END $$;
SELECT pg_temp.expect_error($$INSERT INTO quiz_attempts (school_id, learner_id, module_release_id, assessment_version_id, attempt_no)
  VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1)$$, '23505', 'DB27e trùng attempt_no bị từ chối');
INSERT INTO quiz_attempts (id, school_id, learner_id, module_release_id, assessment_version_id, attempt_no, status, submitted_at, score, max_score) VALUES
  ('87000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1, 'submitted', now(), 0, 1);
DO $$ BEGIN RAISE NOTICE 'PASS DB27f lượt đã nộp điểm 0 được ghi'; END $$;

-- DB28 câu trả lời append-only
SELECT pg_temp.expect_error($$INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response)
  VALUES ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 0, '{"option":"b"}'::jsonb)$$, '23514', 'DB28 try_no 0 bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, hints_used)
  VALUES ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 1, '{"option":"b"}'::jsonb, 4)$$, '23514', 'DB28b hints_used 4 bị từ chối');
INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct, hints_used) VALUES
  ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 1, '{"option":"b"}'::jsonb, false, 2);
DO $$ BEGIN RAISE NOTICE 'PASS DB28c câu trả lời hợp lệ được ghi'; END $$;
SELECT pg_temp.expect_error($$INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response)
  VALUES ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 1, '{"option":"a"}'::jsonb)$$, '23505', 'DB28d trùng try_no bị từ chối');
SELECT pg_temp.expect_error($$UPDATE question_responses SET correct = true WHERE attempt_id = '87000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB28e câu trả lời không sửa được');
SELECT pg_temp.expect_error($$DELETE FROM question_responses WHERE attempt_id = '87000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB28f câu trả lời không xóa được');
INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct) VALUES
  ('00000000-0000-0000-0000-00000000000a', '87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 2, '{"notLearned":true}'::jsonb, NULL);
DO $$ BEGIN RAISE NOTICE 'PASS DB28g notLearned để correct NULL'; END $$;

-- DB29 gợi ý và khóa
SELECT pg_temp.expect_error($$INSERT INTO attempt_hint_usage (attempt_id, question_item_id, hints_used)
  VALUES ('87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 0)$$, '23514', 'DB29 hints_used 0 bị từ chối');
SELECT pg_temp.expect_error($$INSERT INTO attempt_hint_usage (attempt_id, question_item_id, hints_used)
  VALUES ('87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 4)$$, '23514', 'DB29b hints_used 4 bị từ chối');
INSERT INTO attempt_hint_usage (attempt_id, question_item_id, hints_used) VALUES
  ('87000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 2);
DO $$ BEGIN RAISE NOTICE 'PASS DB29c gợi ý bậc 2 được ghi'; END $$;
SELECT pg_temp.expect_error($$INSERT INTO module_items (module_version_id, position, item_type, title, completion_rule)
  VALUES ('81000000-0000-0000-0000-000000000001', 1, 'quiz', 'Chẩn đoán', 'submit');
  INSERT INTO assessment_versions (module_version_id, module_item_id, purpose, show_feedback, hints_enabled)
  SELECT '81000000-0000-0000-0000-000000000001', id, 'diagnostic', 'after_submit', true FROM module_items WHERE position = 1$$, '23514', 'DB29d gợi ý ngoài practice bị từ chối');
DO $$ BEGIN RAISE NOTICE 'PASS DB29e practice được bật gợi ý'; END $$;
SELECT pg_temp.expect_error($$UPDATE question_keys SET key = '{"option":"b"}'::jsonb WHERE question_item_id = '84000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB29f khóa đáp án không sửa được');
SELECT pg_temp.expect_error($$DELETE FROM question_keys WHERE question_item_id = '84000000-0000-0000-0000-000000000001'$$, 'append-only', 'DB29g khóa đáp án không xóa được');
DO $$ BEGIN
  IF has_table_privilege('hcn_worker', 'question_keys', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL DB29h worker vẫn đọc được question_keys';
  END IF;
  IF NOT has_table_privilege('hcn_app', 'question_keys', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL DB29i app không đọc được question_keys';
  END IF;
  RAISE NOTICE 'PASS DB29h worker không đọc question_keys';
  RAISE NOTICE 'PASS DB29i app đọc question_keys';
END $$;

ROLLBACK;
