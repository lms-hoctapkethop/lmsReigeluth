-- migrate:up
-- Học cùng nhau 3.2 · nhật ký duyệt chương trình, cờ trích xuất, đồ thị hiệu lực.
-- Không sửa migration đã có. Cột mới có mặc định để DB01–DB16 vẫn chèn được.

ALTER TABLE curriculum_requirements
  ADD COLUMN extraction text NOT NULL DEFAULT 'clean' CHECK (extraction IN ('clean', 'check')),
  ADD COLUMN extraction_flags text[] NOT NULL DEFAULT '{}';

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
  old_text     text,
  new_text     text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX curriculum_review_log_entity_idx ON curriculum_review_log (entity_type, entity_id);

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

GRANT SELECT, INSERT, UPDATE, DELETE ON curriculum_review_log TO hcn_app;
GRANT SELECT ON curriculum_review_log TO hcn_worker, hcn_readonly;
GRANT SELECT ON effective_kc_edges TO hcn_app, hcn_worker, hcn_readonly;

-- migrate:down
DROP VIEW IF EXISTS effective_kc_edges;
DROP TABLE IF EXISTS curriculum_review_log;
ALTER TABLE misconceptions DROP COLUMN IF EXISTS created_by;
ALTER TABLE requirement_kc_links DROP COLUMN IF EXISTS created_by;
ALTER TABLE kc_edges DROP COLUMN IF EXISTS created_by;
ALTER TABLE curriculum_requirements DROP COLUMN IF EXISTS extraction_flags;
ALTER TABLE curriculum_requirements DROP COLUMN IF EXISTS extraction;
