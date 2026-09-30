-- migrate:up
-- Học cùng nhau 3.7 · 0009 nền dữ liệu chẩn đoán (M8).
-- 1) question_responses.points: điểm câu 0..1 do use case chấm ghi lúc INSERT (multi_choice partial cần điểm lẻ;
--    worker không được đọc question_keys nên không tự chấm lại được). NULL ở hàng cũ = suy từ correct.
-- 2) Quan sát, ước lượng, tín hiệu lỗi hiểu sai chỉ worker ghi (INV-11: API không bao giờ tạo quan sát).
-- 3) needs_estimates chỉ thêm (đổi mô hình = hàng mới với model_version mới, giữ lịch sử, B11).
-- 4) View needs_current_kc: ước lượng mới nhất theo KC (gộp mọi version của một KC), dùng cho hồ sơ và bản đồ nhiệt.

ALTER TABLE question_responses
  ADD COLUMN points numeric(4,3)
    CHECK (points IS NULL OR (points BETWEEN 0 AND 1 AND correct IS NOT NULL AND correct = (points = 1)));

REVOKE INSERT, UPDATE, DELETE ON observations, needs_estimates, misconception_signals FROM hcn_app;
GRANT SELECT ON observations, needs_estimates, misconception_signals TO hcn_app;

CREATE TRIGGER needs_estimates_immutable BEFORE UPDATE OR DELETE ON needs_estimates
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE VIEW needs_current_kc AS
SELECT DISTINCT ON (n.learner_id, n.offering_id, v.kc_id, n.model_version)
       n.id, n.school_id, n.learner_id, n.offering_id, v.kc_id, n.kc_version_id,
       n.status, n.value, n.n_observations, n.model_version, n.observation_ids, n.computed_at
  FROM needs_estimates n
  JOIN kc_versions v ON v.id = n.kc_version_id
 ORDER BY n.learner_id, n.offering_id, v.kc_id, n.model_version, n.computed_at DESC, n.id DESC;

GRANT SELECT ON needs_current_kc TO hcn_app, hcn_worker, hcn_readonly;

-- migrate:down
REVOKE ALL ON needs_current_kc FROM hcn_app, hcn_worker, hcn_readonly;
DROP VIEW IF EXISTS needs_current_kc;
DROP TRIGGER IF EXISTS needs_estimates_immutable ON needs_estimates;
GRANT INSERT, UPDATE, DELETE ON observations, needs_estimates, misconception_signals TO hcn_app;
ALTER TABLE question_responses DROP COLUMN IF EXISTS points;
