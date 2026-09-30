-- migrate:up
-- Học cùng nhau · M5. Cột submission_config và bảng content_files.
-- Không sửa migration đã merge.

ALTER TABLE module_items
  ADD COLUMN submission_config jsonb;

ALTER TABLE module_items
  ADD CONSTRAINT module_items_submission_config_chk CHECK (
    CASE
      WHEN submission_config IS NULL THEN true
      WHEN item_type <> 'assignment' THEN false
      WHEN jsonb_typeof(submission_config) <> 'object' THEN false
      WHEN (submission_config - 'types' - 'allowFiles' - 'maxFiles') <> '{}'::jsonb THEN false
      WHEN NOT (submission_config ? 'types') THEN false
      WHEN jsonb_typeof(submission_config->'types') <> 'array' THEN false
      WHEN jsonb_array_length(submission_config->'types') NOT BETWEEN 1 AND 3 THEN false
      WHEN NOT ((submission_config->'types') <@ '["text","code","rich"]'::jsonb) THEN false
      WHEN (
        (submission_config->'types' ? 'text')::int
        + (submission_config->'types' ? 'code')::int
        + (submission_config->'types' ? 'rich')::int
      ) <> jsonb_array_length(submission_config->'types') THEN false
      WHEN submission_config ? 'allowFiles' AND jsonb_typeof(submission_config->'allowFiles') <> 'boolean' THEN false
      WHEN submission_config ? 'maxFiles' AND NOT (
        jsonb_typeof(submission_config->'maxFiles') = 'number'
        AND (submission_config->>'maxFiles') ~ '^[0-9]+$'
        AND (submission_config->>'maxFiles')::integer BETWEEN 0 AND 10
      ) THEN false
      ELSE true
    END
  );

CREATE TABLE content_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL,
  module_version_id  uuid NOT NULL,
  module_item_id     uuid NOT NULL,
  file_id            uuid NOT NULL,
  alt                text NOT NULL CHECK (char_length(alt) BETWEEN 1 AND 300),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_item_id, file_id),
  FOREIGN KEY (module_version_id, school_id) REFERENCES module_versions (id, school_id),
  FOREIGN KEY (module_item_id, module_version_id) REFERENCES module_items (id, module_version_id),
  FOREIGN KEY (file_id, school_id) REFERENCES files (id, school_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON content_files TO hcn_app;
GRANT SELECT ON content_files TO hcn_worker, hcn_readonly;
GRANT DELETE ON idempotency_keys, sessions TO hcn_worker;

-- migrate:down
REVOKE DELETE ON idempotency_keys, sessions FROM hcn_worker;
DROP TABLE IF EXISTS content_files;
ALTER TABLE module_items DROP CONSTRAINT IF EXISTS module_items_submission_config_chk;
ALTER TABLE module_items DROP COLUMN IF EXISTS submission_config;
