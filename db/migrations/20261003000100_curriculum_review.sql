-- migrate:up
-- Học cùng nhau 3.2 · nhật ký duyệt chương trình, cờ trích xuất, đồ thị hiệu lực.
-- Không sửa migration đã có. Cột mới có mặc định để DB01–DB16 vẫn chèn được.
-- Nhật ký giữ tên cột của repo. Bổ sung trạng thái, bất biến append-only và kiểm chu trình theo đặc tả 3.3.

ALTER TABLE curriculum_requirements
  ADD COLUMN extraction text NOT NULL DEFAULT 'clean' CHECK (extraction IN ('clean', 'check')),
  ADD COLUMN extraction_flags text[] NOT NULL DEFAULT '{}';
CREATE INDEX curriculum_requirements_queue_idx ON curriculum_requirements (review_status, extraction);

ALTER TABLE kc_edges
  ADD COLUMN created_by uuid REFERENCES users(id);

ALTER TABLE requirement_kc_links
  ADD COLUMN created_by uuid REFERENCES users(id);

ALTER TABLE misconceptions
  ADD COLUMN created_by uuid REFERENCES users(id);

CREATE TABLE curriculum_review_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL CHECK (entity_type IN ('requirement', 'kc_version', 'kc_edge', 'requirement_kc_link', 'misconception')),
  entity_id    uuid NOT NULL,
  action       text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES users(id),
  from_status  text,
  to_status    text NOT NULL,
  note         text CHECK (note IS NULL OR length(note) <= 2000),
  old_text     text,
  new_text     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((old_text IS NULL) = (new_text IS NULL)),
  CHECK (old_text IS NULL OR entity_type = 'requirement')
);
CREATE INDEX curriculum_review_log_entity_idx ON curriculum_review_log (entity_type, entity_id);
CREATE TRIGGER curriculum_review_log_immutable BEFORE UPDATE OR DELETE ON curriculum_review_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Cạnh dùng cho publish, R0, lộ trình, bản đồ nhiệt: cả hai version còn approved và cạnh đã duyệt.
CREATE VIEW effective_kc_edges AS
SELECT e.id,
       e.from_kc_version_id,
       e.to_kc_version_id,
       e.edge_type,
       e.status,
       e.source,
       e.rationale,
       e.reviewed_by,
       e.created_by,
       e.created_at
  FROM kc_edges e
  JOIN kc_versions src ON src.id = e.from_kc_version_id AND src.status = 'approved'
  JOIN kc_versions dst ON dst.id = e.to_kc_version_id AND dst.status = 'approved'
 WHERE e.status = 'approved';

-- Kiểm chu trình: bỏ qua cạnh chạm version superseded hoặc rejected (lịch sử), vẫn chặn vòng giữa version approved/proposed.
CREATE OR REPLACE FUNCTION kc_edges_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  has_cycle boolean;
BEGIN
  IF NEW.status <> 'approved' OR NEW.edge_type NOT IN ('prerequisite','develops_into') THEN
    RETURN NEW;
  END IF;
  LOCK TABLE kc_edges IN SHARE ROW EXCLUSIVE MODE;
  WITH RECURSIVE live AS (
    SELECT e.id, e.from_kc_version_id, e.to_kc_version_id
      FROM kc_edges e
      JOIN kc_versions f ON f.id = e.from_kc_version_id AND f.status IN ('approved','proposed')
      JOIN kc_versions t ON t.id = e.to_kc_version_id   AND t.status IN ('approved','proposed')
     WHERE e.status = 'approved' AND e.edge_type IN ('prerequisite','develops_into') AND e.id <> NEW.id
  ), reach(node) AS (
    SELECT l.to_kc_version_id FROM live l WHERE l.from_kc_version_id = NEW.to_kc_version_id
    UNION
    SELECT l.to_kc_version_id FROM live l JOIN reach r ON l.from_kc_version_id = r.node
  )
  SELECT EXISTS (SELECT 1 FROM reach WHERE node = NEW.from_kc_version_id) INTO has_cycle;
  IF has_cycle THEN
    RAISE EXCEPTION 'KC_EDGE_CYCLE: edge % -> % would create a cycle', NEW.from_kc_version_id, NEW.to_kc_version_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE UPDATE, DELETE ON curriculum_review_log FROM hcn_app;
GRANT SELECT, INSERT ON curriculum_review_log TO hcn_app;
GRANT SELECT ON curriculum_review_log TO hcn_worker, hcn_readonly;
GRANT SELECT ON effective_kc_edges TO hcn_app, hcn_worker, hcn_readonly;

-- migrate:down
REVOKE ALL ON curriculum_review_log, effective_kc_edges FROM hcn_app, hcn_worker, hcn_readonly;

CREATE OR REPLACE FUNCTION kc_edges_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  has_cycle boolean;
BEGIN
  IF NEW.status <> 'approved' OR NEW.edge_type NOT IN ('prerequisite','develops_into') THEN
    RETURN NEW;
  END IF;
  LOCK TABLE kc_edges IN SHARE ROW EXCLUSIVE MODE;
  WITH RECURSIVE reach(node) AS (
    SELECT e.to_kc_version_id FROM kc_edges e
     WHERE e.from_kc_version_id = NEW.to_kc_version_id
       AND e.status = 'approved' AND e.edge_type IN ('prerequisite','develops_into') AND e.id <> NEW.id
    UNION
    SELECT e.to_kc_version_id FROM kc_edges e JOIN reach r ON e.from_kc_version_id = r.node
     WHERE e.status = 'approved' AND e.edge_type IN ('prerequisite','develops_into') AND e.id <> NEW.id
  )
  SELECT EXISTS (SELECT 1 FROM reach WHERE node = NEW.from_kc_version_id) INTO has_cycle;
  IF has_cycle THEN
    RAISE EXCEPTION 'KC_EDGE_CYCLE: edge % -> % would create a cycle', NEW.from_kc_version_id, NEW.to_kc_version_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP VIEW IF EXISTS effective_kc_edges;
DROP TABLE IF EXISTS curriculum_review_log;
DROP INDEX IF EXISTS curriculum_requirements_queue_idx;
ALTER TABLE misconceptions DROP COLUMN IF EXISTS created_by;
ALTER TABLE requirement_kc_links DROP COLUMN IF EXISTS created_by;
ALTER TABLE kc_edges DROP COLUMN IF EXISTS created_by;
ALTER TABLE curriculum_requirements DROP COLUMN IF EXISTS extraction_flags;
ALTER TABLE curriculum_requirements DROP COLUMN IF EXISTS extraction;
