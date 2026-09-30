-- migrate:up
-- Học cùng nhau 3.6 · 0008 chốt chặn cho chấm bài, quyết định mức đạt, đồng hành gia đình, thông báo (M7).
-- 1) Mỗi (HS, offering, YCCĐ) có tối đa một quyết định gốc; chuỗi thay thế giữ cùng HS, offering, YCCĐ.
-- 2) Quyết định chỉ dựa trên review của chính bài nộp của HS đó, trong đúng offering.
-- 3) Kết quả tiêu chí của review đã công bố bất biến.
-- 4) family_supports: nội dung bất biến, chỉ committed → cancelled.
-- 5) notifications: hcn_app chỉ được đổi read_at, không xóa.

CREATE UNIQUE INDEX attainment_decisions_one_root_uq
  ON attainment_decisions (learner_id, offering_id, requirement_id)
  WHERE supersedes_id IS NULL;

CREATE OR REPLACE FUNCTION attainment_decisions_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev record;
  ok boolean;
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT learner_id, offering_id, requirement_id INTO prev FROM attainment_decisions WHERE id = NEW.supersedes_id;
    IF prev.learner_id IS DISTINCT FROM NEW.learner_id OR prev.offering_id IS DISTINCT FROM NEW.offering_id
       OR prev.requirement_id IS DISTINCT FROM NEW.requirement_id THEN
      RAISE EXCEPTION 'ATTAINMENT_CHAIN_MISMATCH: supersedes % belongs to another learner, offering or requirement', NEW.supersedes_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT (s.learner_id = NEW.learner_id AND mr.offering_id = NEW.offering_id AND s.school_id = NEW.school_id)
    INTO ok
    FROM reviews r
    JOIN submissions s ON s.id = r.submission_id
    JOIN module_releases mr ON mr.id = s.module_release_id
   WHERE r.id = NEW.review_id;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ATTAINMENT_REVIEW_MISMATCH: review % is not for this learner and offering', NEW.review_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attainment_decisions_check BEFORE INSERT ON attainment_decisions
  FOR EACH ROW EXECUTE FUNCTION attainment_decisions_check();

CREATE OR REPLACE FUNCTION review_criterion_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM reviews WHERE id = COALESCE(NEW.review_id, OLD.review_id);
  IF st = 'published' THEN
    RAISE EXCEPTION 'REVIEW_PUBLISHED: criterion results of a published review are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER review_criterion_results_guard BEFORE INSERT OR UPDATE OR DELETE ON review_criterion_results
  FOR EACH ROW EXECUTE FUNCTION review_criterion_results_guard();

CREATE OR REPLACE FUNCTION family_supports_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'family_supports is append-only (DELETE)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.id, NEW.school_id, NEW.guardian_link_id, NEW.offering_id, NEW.content, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.school_id, OLD.guardian_link_id, OLD.offering_id, OLD.content, OLD.created_at)
     OR NOT (OLD.status = 'committed' AND NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'family_supports: only committed -> cancelled with cancelled_at is allowed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER family_supports_guard BEFORE UPDATE OR DELETE ON family_supports
  FOR EACH ROW EXECUTE FUNCTION family_supports_guard();

REVOKE UPDATE, DELETE ON notifications FROM hcn_app;
GRANT UPDATE (read_at) ON notifications TO hcn_app;

-- migrate:down
REVOKE UPDATE (read_at) ON notifications FROM hcn_app;
GRANT UPDATE, DELETE ON notifications TO hcn_app;
DROP TRIGGER IF EXISTS family_supports_guard ON family_supports;
DROP FUNCTION IF EXISTS family_supports_guard();
DROP TRIGGER IF EXISTS review_criterion_results_guard ON review_criterion_results;
DROP FUNCTION IF EXISTS review_criterion_results_guard();
DROP TRIGGER IF EXISTS attainment_decisions_check ON attainment_decisions;
DROP FUNCTION IF EXISTS attainment_decisions_check();
DROP INDEX IF EXISTS attainment_decisions_one_root_uq;
