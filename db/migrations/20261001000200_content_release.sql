-- migrate:up
-- Học cùng nhau 3.0 · 0002 nội dung: module, mục, câu hỏi, khóa, rubric, giao bài.

CREATE TABLE modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL,
  course_id   uuid NOT NULL,
  owner_id    uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  FOREIGN KEY (course_id, school_id) REFERENCES courses(id, school_id)
);

CREATE TABLE module_collaborators (
  module_id  uuid NOT NULL REFERENCES modules(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role       text NOT NULL CHECK (role IN ('editor','viewer')),
  PRIMARY KEY (module_id, user_id)
);

-- Bản nháp có thể sửa; revision chống ghi đè (INV-09). payload theo schema ModuleDraft trong packages/contracts.
CREATE TABLE module_drafts (
  module_id   uuid PRIMARY KEY REFERENCES modules(id),
  school_id   uuid NOT NULL,
  revision    integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  payload     jsonb NOT NULL,
  updated_by  uuid NOT NULL REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (module_id, school_id) REFERENCES modules(id, school_id)
);

-- Phiên bản phát hành: bất biến
CREATE TABLE module_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL,
  module_id       uuid NOT NULL,
  version_no      integer NOT NULL CHECK (version_no > 0),
  title           text NOT NULL,
  description     text,
  requirement_ids uuid[] NOT NULL,                 -- YCCĐ phạm vi module
  coverage_report jsonb NOT NULL,                  -- ma trận độ phủ và cảnh báo V01–V08 lúc publish
  coverage_ack    jsonb,                           -- lý do GV giữ cảnh báo (V02, V08…)
  digest          text NOT NULL,                   -- sha256 của nội dung chuẩn hóa
  published_by    uuid NOT NULL REFERENCES users(id),
  published_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, version_no),
  UNIQUE (id, school_id),
  FOREIGN KEY (module_id, school_id) REFERENCES modules(id, school_id)
);
CREATE TRIGGER module_versions_immutable BEFORE UPDATE OR DELETE ON module_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE rubric_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_version_id  uuid NOT NULL REFERENCES module_versions(id),
  title              text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER rubric_versions_immutable BEFORE UPDATE OR DELETE ON rubric_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE rubric_criteria (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_version_id  uuid NOT NULL REFERENCES rubric_versions(id),
  position           smallint NOT NULL CHECK (position >= 0),
  title              text NOT NULL,
  kc_version_id      uuid REFERENCES kc_versions(id),   -- NULL → cảnh báo V08
  level_meets        text NOT NULL,
  level_developing   text NOT NULL,
  level_not_yet      text NOT NULL,
  UNIQUE (rubric_version_id, position)
);
CREATE TRIGGER rubric_criteria_immutable BEFORE UPDATE OR DELETE ON rubric_criteria FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE module_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_version_id  uuid NOT NULL REFERENCES module_versions(id),
  position           smallint NOT NULL CHECK (position >= 0),
  item_type          text NOT NULL CHECK (item_type IN ('header','page','assignment','quiz','link')),
  indent             smallint NOT NULL DEFAULT 0 CHECK (indent IN (0,1)),
  title              text NOT NULL,
  body               jsonb,                            -- rich text đã sanitize (page, assignment)
  url                text,                             -- link
  completion_rule    text NOT NULL CHECK (completion_rule IN ('none','view','self_mark','submit')),
  rubric_version_id  uuid REFERENCES rubric_versions(id),
  requirement_ids    uuid[] NOT NULL DEFAULT '{}',
  UNIQUE (module_version_id, position),
  UNIQUE (id, module_version_id),
  -- Module 3.2.1: completion hợp lệ theo loại mục
  CHECK (
    (item_type = 'header'     AND completion_rule = 'none') OR
    (item_type = 'page'       AND completion_rule IN ('none','view','self_mark')) OR
    (item_type = 'assignment' AND completion_rule IN ('none','submit')) OR
    (item_type = 'quiz'       AND completion_rule IN ('none','submit')) OR
    (item_type = 'link'       AND completion_rule IN ('none','view'))
  ),
  CHECK (item_type <> 'link' OR url ~ '^https://'),
  CHECK (item_type = 'assignment' OR rubric_version_id IS NULL)
);
CREATE TRIGGER module_items_immutable BEFORE UPDATE OR DELETE ON module_items FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE assessment_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_version_id  uuid NOT NULL,
  module_item_id     uuid NOT NULL UNIQUE,
  purpose            text NOT NULL CHECK (purpose IN ('diagnostic','practice','exit_ticket','self_assessment','summative')),
  max_attempts       smallint CHECK (max_attempts IS NULL OR max_attempts > 0),   -- NULL = không giới hạn (practice)
  show_feedback      text NOT NULL CHECK (show_feedback IN ('immediate','after_submit','after_due','never')),
  hints_enabled      boolean NOT NULL DEFAULT false,
  shuffle_options    boolean NOT NULL DEFAULT false,
  FOREIGN KEY (module_item_id, module_version_id) REFERENCES module_items(id, module_version_id),
  CHECK (purpose = 'practice' OR hints_enabled = false),
  UNIQUE (id, module_version_id)
);
CREATE TRIGGER assessment_versions_immutable BEFORE UPDATE OR DELETE ON assessment_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Nội dung câu hỏi cho HS: không chứa đáp án (INV-06)
CREATE TABLE question_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_version_id  uuid NOT NULL REFERENCES assessment_versions(id),
  position               smallint NOT NULL CHECK (position >= 0),
  qtype                  text NOT NULL CHECK (qtype IN ('single_choice','multi_choice','numeric','short_text')),
  stem                   jsonb NOT NULL,               -- rich text đã sanitize
  options                jsonb,                        -- [{id:'a', label:jsonb}] cho câu chọn
  bloom_target           smallint NOT NULL CHECK (bloom_target BETWEEN 1 AND 6),
  variant_group          text,
  difficulty_prior       text CHECK (difficulty_prior IN ('easy','medium','hard')),
  difficulty_calibrated  numeric,
  provisional            boolean NOT NULL DEFAULT false,
  hints                  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(hints) = 'array' AND jsonb_array_length(hints) <= 3),
  source                 text NOT NULL CHECK (source IN ('teacher','library','ai_proposal','import')),
  ai_proposal_id         uuid,
  approved_by            uuid REFERENCES users(id),
  UNIQUE (assessment_version_id, position),
  CHECK (qtype NOT IN ('single_choice','multi_choice') OR jsonb_typeof(options) = 'array'),
  CHECK (source <> 'ai_proposal' OR approved_by IS NOT NULL)          -- V07
);
CREATE TRIGGER question_items_immutable BEFORE UPDATE OR DELETE ON question_items FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Khóa đáp án tách bảng: vai trò DB của API học sinh không được SELECT (xem docs/03 mục quyền DB)
CREATE TABLE question_keys (
  question_item_id  uuid PRIMARY KEY REFERENCES question_items(id),
  key               jsonb NOT NULL,     -- single: {"option":"b"}; multi: {"options":["a","c"],"scoring":"all_or_nothing"}; numeric: {"value":"5/6","tolerance":0,"accept":["0,8333"]}
  rationale         jsonb
);
CREATE TRIGGER question_keys_immutable BEFORE UPDATE OR DELETE ON question_keys FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE question_kc_links (
  question_item_id  uuid NOT NULL REFERENCES question_items(id),
  kc_version_id     uuid NOT NULL REFERENCES kc_versions(id),
  role              text NOT NULL CHECK (role IN ('required','observable')),
  PRIMARY KEY (question_item_id, kc_version_id, role)
);
CREATE TRIGGER question_kc_links_immutable BEFORE UPDATE OR DELETE ON question_kc_links FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE option_misconceptions (
  question_item_id  uuid NOT NULL REFERENCES question_items(id),
  option_id         text NOT NULL,
  misconception_id  uuid NOT NULL REFERENCES misconceptions(id),
  PRIMARY KEY (question_item_id, option_id)
);
CREATE TRIGGER option_misconceptions_immutable BEFORE UPDATE OR DELETE ON option_misconceptions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ============================================================ Giao bài

CREATE TABLE path_releases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL,
  offering_id  uuid NOT NULL,
  title        text NOT NULL,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id)
);

CREATE TABLE module_releases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL,
  offering_id        uuid NOT NULL,
  path_release_id    uuid NOT NULL,
  module_version_id  uuid NOT NULL,
  position           smallint NOT NULL CHECK (position >= 0),
  available_from     timestamptz NOT NULL,
  due_at             timestamptz,
  accept_until       timestamptz,
  late_policy        text NOT NULL DEFAULT 'accept_marked' CHECK (late_policy IN ('reject','accept_marked')),
  schedule_revision  integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (due_at IS NULL OR due_at > available_from),
  CHECK (accept_until IS NULL OR (due_at IS NOT NULL AND accept_until >= due_at)),
  UNIQUE (path_release_id, position),
  UNIQUE (id, school_id),
  FOREIGN KEY (path_release_id, school_id) REFERENCES path_releases(id, school_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id),
  FOREIGN KEY (module_version_id, school_id) REFERENCES module_versions(id, school_id)
);
CREATE INDEX module_releases_offering_idx ON module_releases (offering_id, available_from);

-- Đổi lịch sau khi giao: ghi lịch sử, không sửa nội dung (2.1 mục 6)
CREATE TABLE release_schedule_changes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_release_id  uuid NOT NULL REFERENCES module_releases(id),
  from_revision      integer NOT NULL,
  old_values         jsonb NOT NULL,
  new_values         jsonb NOT NULL,
  reason             text NOT NULL,
  changed_by         uuid NOT NULL REFERENCES users(id),
  changed_at         timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS release_schedule_changes;
DROP TABLE IF EXISTS module_releases;
DROP TABLE IF EXISTS path_releases;
DROP TABLE IF EXISTS option_misconceptions;
DROP TABLE IF EXISTS question_kc_links;
DROP TABLE IF EXISTS question_keys;
DROP TABLE IF EXISTS question_items;
DROP TABLE IF EXISTS assessment_versions;
DROP TABLE IF EXISTS module_items;
DROP TABLE IF EXISTS rubric_criteria;
DROP TABLE IF EXISTS rubric_versions;
DROP TABLE IF EXISTS module_versions;
DROP TABLE IF EXISTS module_drafts;
DROP TABLE IF EXISTS module_collaborators;
DROP TABLE IF EXISTS modules;
