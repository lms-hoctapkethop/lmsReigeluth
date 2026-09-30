-- migrate:up
-- Học cùng nhau 3.0 · 0003 học tập, đánh giá, hồ sơ, nền AI, hạ tầng.

-- ============================================================ Tệp
CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES schools(id),
  owner_id        uuid NOT NULL REFERENCES users(id),
  storage_key     text NOT NULL UNIQUE,              -- đường dẫn nội bộ sinh ngẫu nhiên, không dùng tên người dùng
  sha256          char(64) NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),   -- 25 MiB
  mime_detected   text NOT NULL,
  original_name   text NOT NULL,
  scan_status     text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','error')),
  scanned_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id)
);

-- ============================================================ Tiến độ (INV-04: không liên quan mức đạt)
CREATE TABLE activity_progress (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL,
  learner_id         uuid NOT NULL REFERENCES users(id),
  module_release_id  uuid NOT NULL,
  module_item_id     uuid NOT NULL REFERENCES module_items(id),
  status             text NOT NULL CHECK (status IN ('in_progress','completed')),
  completion_rule    text NOT NULL CHECK (completion_rule IN ('view','self_mark','submit')),
  source_event       text NOT NULL,        -- 'page_view', 'self_mark', 'submission:<id>', 'quiz_attempt:<id>'
  completed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  UNIQUE (learner_id, module_release_id, module_item_id),
  FOREIGN KEY (module_release_id, school_id) REFERENCES module_releases(id, school_id)
);

-- ============================================================ Bài nộp
CREATE TABLE submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL,
  learner_id          uuid NOT NULL REFERENCES users(id),
  module_release_id   uuid NOT NULL,
  module_item_id      uuid NOT NULL REFERENCES module_items(id),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','changes_requested','reviewed')),
  current_version_no  integer NOT NULL DEFAULT 0 CHECK (current_version_no >= 0),
  draft_revision      integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  draft_body          jsonb,
  draft_updated_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, module_release_id, module_item_id),
  UNIQUE (id, school_id),
  FOREIGN KEY (module_release_id, school_id) REFERENCES module_releases(id, school_id)
);
CREATE INDEX submissions_queue_idx ON submissions (module_release_id, status);   -- hàng chờ chấm của GV

CREATE TABLE submission_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid NOT NULL REFERENCES submissions(id),
  version_no      integer NOT NULL CHECK (version_no > 0),
  body            jsonb NOT NULL,       -- {type:'text'|'code'|'rich', language?, text, test_cases?:[...]}
  reflection      text,
  content_hash    char(64) NOT NULL,
  is_late         boolean NOT NULL DEFAULT false,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, version_no)
);
CREATE TRIGGER submission_versions_immutable BEFORE UPDATE OR DELETE ON submission_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE submission_version_files (
  submission_version_id  uuid NOT NULL REFERENCES submission_versions(id),
  file_id                uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (submission_version_id, file_id)
);
CREATE TRIGGER submission_version_files_immutable BEFORE UPDATE OR DELETE ON submission_version_files FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ============================================================ Quiz
CREATE TABLE quiz_attempts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid NOT NULL,
  learner_id             uuid NOT NULL REFERENCES users(id),
  module_release_id      uuid NOT NULL,
  assessment_version_id  uuid NOT NULL REFERENCES assessment_versions(id),
  attempt_no             integer NOT NULL CHECK (attempt_no > 0),
  status                 text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted')),
  option_order           jsonb,              -- thứ tự đã xáo, đóng băng
  started_at             timestamptz NOT NULL DEFAULT now(),
  submitted_at           timestamptz,
  score                  numeric(6,3),
  max_score              numeric(6,3),
  CHECK (status <> 'submitted' OR submitted_at IS NOT NULL),
  UNIQUE (learner_id, module_release_id, assessment_version_id, attempt_no),
  UNIQUE (id, school_id),
  FOREIGN KEY (module_release_id, school_id) REFERENCES module_releases(id, school_id)
);

-- Mỗi lần trả lời là một sự kiện; practice có thể nhiều lần cho cùng câu
CREATE TABLE question_responses (
  id                bigserial PRIMARY KEY,
  school_id         uuid NOT NULL,
  attempt_id        uuid NOT NULL,
  question_item_id  uuid NOT NULL REFERENCES question_items(id),
  try_no            smallint NOT NULL CHECK (try_no > 0),
  response          jsonb NOT NULL,          -- {"option":"a"} | {"options":["a","c"]} | {"raw":"0,5","normalized":"0.5"}
  correct           boolean,                 -- NULL khi chưa chấm (short_text)
  hints_used        smallint NOT NULL DEFAULT 0 CHECK (hints_used BETWEEN 0 AND 3),
  misconception_id  uuid REFERENCES misconceptions(id),
  answered_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_item_id, try_no),
  FOREIGN KEY (attempt_id, school_id) REFERENCES quiz_attempts(id, school_id)
);
CREATE TRIGGER question_responses_immutable BEFORE UPDATE OR DELETE ON question_responses FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Số gợi ý đã mở cho từng câu trong một lượt (chỉ practice)
CREATE TABLE attempt_hint_usage (
  attempt_id        uuid NOT NULL REFERENCES quiz_attempts(id),
  question_item_id  uuid NOT NULL REFERENCES question_items(id),
  hints_used        smallint NOT NULL CHECK (hints_used BETWEEN 1 AND 3),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_item_id)
);

-- ============================================================ Review và quyết định
CREATE TABLE reviews (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid NOT NULL,
  submission_id          uuid NOT NULL,
  submission_version_id  uuid NOT NULL REFERENCES submission_versions(id),
  rubric_version_id      uuid REFERENCES rubric_versions(id),
  reviewer_id            uuid NOT NULL REFERENCES users(id),
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  revision               integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  comment                text,
  outcome                text CHECK (outcome IN ('reviewed','changes_requested')),
  published_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR (published_at IS NOT NULL AND outcome IS NOT NULL)),
  UNIQUE (id, school_id),
  FOREIGN KEY (submission_id, school_id) REFERENCES submissions(id, school_id)
);
-- Một bản nháp review đang mở cho mỗi phiên bản bài nộp
CREATE UNIQUE INDEX reviews_one_draft_uq ON reviews (submission_version_id) WHERE status = 'draft';
-- Review đã công bố không sửa
CREATE OR REPLACE FUNCTION reviews_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'published review cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'published review is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); RETURN NEW; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER reviews_guard BEFORE UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION reviews_guard();

CREATE TABLE review_criterion_results (
  review_id           uuid NOT NULL REFERENCES reviews(id),
  rubric_criterion_id uuid NOT NULL REFERENCES rubric_criteria(id),
  level               text NOT NULL CHECK (level IN ('meets','developing','not_yet','not_shown')),
  note                text,
  PRIMARY KEY (review_id, rubric_criterion_id)
);

CREATE TABLE attainment_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL,
  learner_id      uuid NOT NULL REFERENCES users(id),
  offering_id     uuid NOT NULL,
  requirement_id  uuid NOT NULL REFERENCES curriculum_requirements(id),
  decision        text NOT NULL CHECK (decision IN ('achieved','not_yet')),
  review_id       uuid NOT NULL REFERENCES reviews(id),      -- chỉ review đã công bố (kiểm trong use case và trigger)
  decided_by      uuid NOT NULL REFERENCES users(id),
  reason          text,
  supersedes_id   uuid REFERENCES attainment_decisions(id),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (supersedes_id IS NULL OR reason IS NOT NULL),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id)
);
CREATE TRIGGER attainment_decisions_immutable BEFORE UPDATE OR DELETE ON attainment_decisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- Mỗi quyết định chỉ bị thay một lần → chuỗi tuyến tính
CREATE UNIQUE INDEX attainment_decisions_supersede_uq ON attainment_decisions (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX attainment_decisions_learner_idx ON attainment_decisions (learner_id, offering_id, requirement_id, decided_at DESC);

CREATE OR REPLACE FUNCTION attainment_requires_published_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM reviews WHERE id = NEW.review_id;
  IF st IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'ATTAINMENT_REQUIRES_PUBLISHED_REVIEW' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
-- Trigger DEFERRABLE: publishReview ghi review published rồi decision trong cùng giao dịch
CREATE CONSTRAINT TRIGGER attainment_requires_published_review
  AFTER INSERT ON attainment_decisions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION attainment_requires_published_review();

-- Quyết định hiện hành = không bị decision nào khác thay thế
CREATE VIEW attainment_current AS
SELECT d.* FROM attainment_decisions d
WHERE NOT EXISTS (SELECT 1 FROM attainment_decisions n WHERE n.supersedes_id = d.id);

-- ============================================================ Nền AI: quan sát, ước lượng, đề xuất (INV-11)
CREATE TABLE observations (
  id              bigserial PRIMARY KEY,
  school_id       uuid NOT NULL,
  learner_id      uuid NOT NULL REFERENCES users(id),
  offering_id     uuid NOT NULL,
  kc_version_id   uuid NOT NULL REFERENCES kc_versions(id),
  source_type     text NOT NULL CHECK (source_type IN ('review','diagnostic','practice','exit_ticket')),
  source_ref      text NOT NULL,                    -- 'review_criterion:<review_id>:<criterion_id>' | 'response:<id>'
  weight          numeric(4,3) NOT NULL CHECK (weight > 0 AND weight <= 1),
  score           numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  hints_used      smallint NOT NULL DEFAULT 0,
  provisional_item boolean NOT NULL DEFAULT false,
  observed_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_ref, kc_version_id),               -- B02: xử lý lại cùng sự kiện không nhân đôi
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id)
);
CREATE TRIGGER observations_immutable BEFORE UPDATE OR DELETE ON observations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE INDEX observations_learner_kc_idx ON observations (learner_id, offering_id, kc_version_id, observed_at);

CREATE TABLE needs_estimates (
  id                  bigserial PRIMARY KEY,
  school_id           uuid NOT NULL,
  learner_id          uuid NOT NULL REFERENCES users(id),
  offering_id         uuid NOT NULL,
  kc_version_id       uuid NOT NULL REFERENCES kc_versions(id),
  status              text NOT NULL CHECK (status IN ('insufficient','needs_support','developing','strong')),
  value               numeric(5,4),
  n_observations      integer NOT NULL,
  model_version       text NOT NULL,                 -- 'R0@1.0.0'
  observation_ids     bigint[] NOT NULL,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id)
);
CREATE INDEX needs_estimates_latest_idx ON needs_estimates (learner_id, offering_id, kc_version_id, model_version, computed_at DESC);
CREATE VIEW needs_current AS
SELECT DISTINCT ON (learner_id, offering_id, kc_version_id, model_version) *
FROM needs_estimates
ORDER BY learner_id, offering_id, kc_version_id, model_version, computed_at DESC;

CREATE TABLE misconception_signals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  learner_id        uuid NOT NULL REFERENCES users(id),
  offering_id       uuid NOT NULL,
  misconception_id  uuid NOT NULL REFERENCES misconceptions(id),
  evidence_response_ids bigint[] NOT NULL,
  distinct_items    integer NOT NULL,
  status            text NOT NULL CHECK (status IN ('seen_once','signal','resolved')),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, offering_id, misconception_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id)
);

CREATE TABLE ai_proposals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id),
  requested_by   uuid NOT NULL REFERENCES users(id),
  kind           text NOT NULL CHECK (kind IN ('question','kc_mapping','kc_edge','feedback_draft','explanation')),
  scope          jsonb NOT NULL,          -- offering, module draft, submission version…
  source_refs    jsonb NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  output         jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','accepted','edited','rejected')),
  decided_by     uuid REFERENCES users(id),
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ Gia đình, thông báo
CREATE TABLE family_supports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  guardian_link_id  uuid NOT NULL,
  offering_id       uuid,
  content           text NOT NULL CHECK (length(content) <= 500),
  status            text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  FOREIGN KEY (guardian_link_id, school_id) REFERENCES guardian_links(id, school_id)
);

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id),
  recipient_id  uuid NOT NULL REFERENCES users(id),
  kind          text NOT NULL,          -- 'review_published', 'release_created', 'due_soon'
  payload       jsonb NOT NULL,         -- chỉ ID và tiêu đề; không chứa nhận xét
  source_event  uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  UNIQUE (recipient_id, source_event)   -- A08: worker chạy lại không tạo trùng
);
CREATE INDEX notifications_inbox_idx ON notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;

-- ============================================================ Hạ tầng
CREATE TABLE sessions (
  id_hash        char(64) PRIMARY KEY,           -- sha256 của cookie; cookie gốc không lưu
  user_id        uuid NOT NULL REFERENCES users(id),
  csrf_token     text NOT NULL,
  context        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {school_id, role, offering_id?, learner_id?}
  id_token_hint  text,                           -- để đăng xuất khỏi Keycloak
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE idempotency_keys (
  actor_id         uuid NOT NULL REFERENCES users(id),
  scope            text NOT NULL,               -- tên lệnh + id tài nguyên
  key              text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  request_hash     char(64) NOT NULL,
  status           text NOT NULL CHECK (status IN ('in_progress','completed')),
  response_status  smallint,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  PRIMARY KEY (actor_id, scope, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);   -- dọn sau 7 ngày

CREATE TABLE outbox_events (
  id              bigserial PRIMARY KEY,
  event_id        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  available_at    timestamptz NOT NULL DEFAULT now(),
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dead')),
  processed_at    timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at, id) WHERE status = 'pending';

CREATE TABLE processed_events (
  event_id      uuid NOT NULL,
  consumer      text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  school_id    uuid,
  actor_id     uuid,
  action       text NOT NULL,          -- 'review.publish', 'guardian_link.verify'…
  object_type  text NOT NULL,
  object_id    text NOT NULL,
  request_id   text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE INDEX audit_log_object_idx ON audit_log (object_type, object_id);

-- migrate:down
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS processed_events;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS family_supports;
DROP TABLE IF EXISTS ai_proposals;
DROP TABLE IF EXISTS misconception_signals;
DROP VIEW IF EXISTS needs_current;
DROP TABLE IF EXISTS needs_estimates;
DROP TABLE IF EXISTS observations;
DROP VIEW IF EXISTS attainment_current;
DROP TABLE IF EXISTS attainment_decisions;
DROP FUNCTION IF EXISTS attainment_requires_published_review();
DROP TABLE IF EXISTS review_criterion_results;
DROP TABLE IF EXISTS reviews;
DROP FUNCTION IF EXISTS reviews_guard();
DROP TABLE IF EXISTS attempt_hint_usage;
DROP TABLE IF EXISTS question_responses;
DROP TABLE IF EXISTS quiz_attempts;
DROP TABLE IF EXISTS submission_version_files;
DROP TABLE IF EXISTS submission_versions;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS activity_progress;
DROP TABLE IF EXISTS files;
