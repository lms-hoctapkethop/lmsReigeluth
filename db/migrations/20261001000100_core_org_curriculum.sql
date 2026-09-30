-- migrate:up
-- Học cùng nhau 3.0 · 0001 nền tảng: tổ chức, danh tính, chương trình, KC.
-- Quy ước: uuid khóa chính (gen_random_uuid), timestamptz UTC, school_id trên dữ liệu nghiệp vụ.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- Chặn UPDATE/DELETE trên bảng bất biến (INV-05)
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- Cập nhật updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ============================================================ Tổ chức và danh tính

CREATE TABLE schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,32}$'),
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_issuer   text NOT NULL,
  oidc_subject  text NOT NULL,
  display_name  text NOT NULL,
  email         citext,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, oidc_subject)
);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE school_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('admin','teacher','student','guardian')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','ended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id, role)
);
CREATE INDEX school_memberships_user_idx ON school_memberships (user_id) WHERE status = 'active';

CREATE TABLE academic_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id),
  code        text NOT NULL CHECK (code ~ '^[0-9]{4}-[0-9]{4}$'),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL CHECK (ends_on > starts_on),
  UNIQUE (school_id, code),
  UNIQUE (id, school_id)
);

CREATE TABLE admin_classes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  grade             smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  code              text NOT NULL,
  homeroom_teacher_id uuid REFERENCES users(id),
  UNIQUE (school_id, academic_year_id, code),
  UNIQUE (id, school_id),
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id)
);

-- Một HS có tối đa một lớp hành chính hiệu lực tại mỗi thời điểm trong một năm học
CREATE TABLE class_memberships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  class_id          uuid NOT NULL,
  learner_id        uuid NOT NULL REFERENCES users(id),
  valid             daterange NOT NULL CHECK (NOT isempty(valid)),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, school_id) REFERENCES admin_classes(id, school_id),
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id),
  EXCLUDE USING gist (learner_id WITH =, academic_year_id WITH =, valid WITH &&)
);

CREATE TABLE guardian_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id),
  guardian_id  uuid NOT NULL REFERENCES users(id),
  learner_id   uuid NOT NULL REFERENCES users(id),
  relation     text NOT NULL DEFAULT 'guardian' CHECK (relation IN ('father','mother','guardian','other')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','revoked')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  verified_by  uuid REFERENCES users(id),
  verified_at  timestamptz,
  revoked_by   uuid REFERENCES users(id),
  revoked_at   timestamptz,
  revoke_reason text,
  CHECK (guardian_id <> learner_id),
  CHECK (status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL)),
  UNIQUE (id, school_id)
);
-- Không có hai liên kết còn hiệu lực cho cùng cặp
CREATE UNIQUE INDEX guardian_links_active_uq ON guardian_links (school_id, guardian_id, learner_id)
  WHERE status IN ('pending','verified');
CREATE INDEX guardian_links_guardian_idx ON guardian_links (guardian_id) WHERE status = 'verified';

-- ============================================================ Chương trình (dữ liệu quốc gia, không có school_id)

CREATE TABLE subjects (
  code        char(4) PRIMARY KEY CHECK (code ~ '^[0-9]{4}$'),   -- mã chương trình + mã môn theo QĐ 791, ví dụ 1401 Tin học, 0201 Toán
  name        text NOT NULL,
  grades      smallint[] NOT NULL
);

CREATE TABLE curriculum_requirements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code791_stem    text NOT NULL UNIQUE CHECK (code791_stem ~ '^[0-9]{6}\.[0-9]{4}[a-z]$'),  -- 140110.0601a
  bloom_level     smallint CHECK (bloom_level BETWEEN 1 AND 6),
  subject_code    char(4) NOT NULL REFERENCES subjects(code),
  grade           smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  unit1           char(2) NOT NULL,
  unit2           char(2) NOT NULL,
  text            text NOT NULL,
  topic_label     text,
  orientation     text CHECK (orientation IN ('common','ICT','CS')),
  source_doc      text NOT NULL,          -- ví dụ 'QD791_PL22_TinHoc'
  source_locator  text,                   -- trang, bảng, dòng
  review_status   text NOT NULL DEFAULT 'unverified' CHECK (review_status IN ('unverified','source_checked','approved','rejected')),
  reviewed_by     uuid REFERENCES users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (substr(code791_stem, 1, 4) = subject_code),
  CHECK (substr(code791_stem, 5, 2)::smallint = grade)
);
CREATE TRIGGER curriculum_requirements_touch BEFORE UPDATE ON curriculum_requirements FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX curriculum_requirements_subject_grade_idx ON curriculum_requirements (subject_code, grade);

-- KC: danh tính + phiên bản bất biến
CREATE TABLE knowledge_components (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code ~ '^KC-[A-Z0-9-]{3,40}$'),
  subject_code  char(4) NOT NULL REFERENCES subjects(code),
  grade         smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kc_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kc_id               uuid NOT NULL REFERENCES knowledge_components(id),
  version_no          integer NOT NULL CHECK (version_no > 0),
  name                text NOT NULL,
  description         text,
  observable_criteria text NOT NULL,
  status              text NOT NULL CHECK (status IN ('proposed','approved','rejected','superseded')),
  source              text NOT NULL CHECK (source IN ('teacher','expert','ai_proposal','import')),
  ai_proposal_id      uuid,
  created_by          uuid REFERENCES users(id),
  reviewed_by         uuid REFERENCES users(id),
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kc_id, version_no),
  CHECK (status NOT IN ('approved','rejected') OR reviewed_by IS NOT NULL)
);
-- Trạng thái duyệt đổi được (proposed → approved/rejected/superseded); nội dung thì không.
CREATE OR REPLACE FUNCTION kc_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kc_versions is append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.kc_id, NEW.version_no, NEW.name, NEW.description, NEW.observable_criteria, NEW.source)
     IS DISTINCT FROM (OLD.kc_id, OLD.version_no, OLD.name, OLD.description, OLD.observable_criteria, OLD.source) THEN
    RAISE EXCEPTION 'kc_versions content is immutable; create a new version' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kc_versions_guard BEFORE UPDATE OR DELETE ON kc_versions FOR EACH ROW EXECUTE FUNCTION kc_versions_guard();

CREATE TABLE requirement_kc_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id  uuid NOT NULL REFERENCES curriculum_requirements(id),
  kc_version_id   uuid NOT NULL REFERENCES kc_versions(id),
  coverage        text NOT NULL DEFAULT 'partial' CHECK (coverage IN ('partial','full')),
  status          text NOT NULL CHECK (status IN ('proposed','approved','rejected')),
  source          text NOT NULL CHECK (source IN ('teacher','expert','ai_proposal','import')),
  reviewed_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requirement_id, kc_version_id)
);

CREATE TABLE kc_edges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_kc_version_id uuid NOT NULL REFERENCES kc_versions(id),   -- tiên quyết
  to_kc_version_id   uuid NOT NULL REFERENCES kc_versions(id),   -- phụ thuộc
  edge_type          text NOT NULL CHECK (edge_type IN ('prerequisite','develops_into','part_of')),
  status             text NOT NULL CHECK (status IN ('proposed','approved','rejected')),
  source             text NOT NULL CHECK (source IN ('teacher','expert','ai_proposal','import')),
  rationale          text,
  reviewed_by        uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (from_kc_version_id <> to_kc_version_id),
  UNIQUE (from_kc_version_id, to_kc_version_id, edge_type)
);
CREATE INDEX kc_edges_to_idx ON kc_edges (to_kc_version_id) WHERE status = 'approved';

-- Đồ thị tiên quyết đã duyệt phải là DAG. Khóa bảng theo mức SHARE ROW EXCLUSIVE để hai giao dịch không cùng thêm cạnh tạo vòng.
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
CREATE TRIGGER kc_edges_no_cycle BEFORE INSERT OR UPDATE ON kc_edges FOR EACH ROW EXECUTE FUNCTION kc_edges_no_cycle();

CREATE TABLE misconceptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code ~ '^M-[A-Z0-9-]{3,40}$'),
  kc_id         uuid NOT NULL REFERENCES knowledge_components(id),
  description   text NOT NULL,
  status        text NOT NULL CHECK (status IN ('proposed','approved','rejected')),
  reviewed_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Người có thẩm quyền duyệt YCCĐ, KC, cạnh, lỗi hiểu sai theo môn (tổ chuyên môn)
CREATE TABLE curriculum_reviewers (
  user_id       uuid NOT NULL REFERENCES users(id),
  subject_code  char(4) NOT NULL REFERENCES subjects(code),
  granted_by    uuid NOT NULL REFERENCES users(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_code)
);

-- ============================================================ Môn học ở trường

CREATE TABLE courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id),
  subject_code  char(4) NOT NULL REFERENCES subjects(code),
  grade         smallint NOT NULL CHECK (grade BETWEEN 1 AND 12),
  title         text NOT NULL,
  orientation   text CHECK (orientation IN ('common','ICT','CS')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id)
);

CREATE TABLE offerings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  course_id         uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  term              smallint NOT NULL CHECK (term IN (1,2)),
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,40}$'),
  title             text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','closed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, academic_year_id, code),
  UNIQUE (id, school_id),
  FOREIGN KEY (course_id, school_id) REFERENCES courses(id, school_id),
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id)
);

CREATE TABLE offering_class_links (
  offering_id  uuid NOT NULL,
  class_id     uuid NOT NULL,
  school_id    uuid NOT NULL,
  PRIMARY KEY (offering_id, class_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id),
  FOREIGN KEY (class_id, school_id) REFERENCES admin_classes(id, school_id)
);

CREATE TABLE teacher_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL,
  offering_id   uuid NOT NULL,
  teacher_id    uuid NOT NULL REFERENCES users(id),
  capabilities  text[] NOT NULL DEFAULT ARRAY['teach','author','release','review']::text[]
                CHECK (capabilities <@ ARRAY['teach','author','release','review','view']::text[]),
  valid         tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
  granted_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id),
  EXCLUDE USING gist (offering_id WITH =, teacher_id WITH =, valid WITH &&)
);
CREATE INDEX teacher_assignments_teacher_idx ON teacher_assignments (teacher_id);

CREATE TABLE offering_enrollments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL,
  offering_id   uuid NOT NULL,
  learner_id    uuid NOT NULL REFERENCES users(id),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  withdrawn_at  timestamptz,
  CHECK (status <> 'withdrawn' OR withdrawn_at IS NOT NULL),
  UNIQUE (offering_id, learner_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES offerings(id, school_id)
);
CREATE INDEX offering_enrollments_learner_idx ON offering_enrollments (learner_id) WHERE status = 'active';

-- migrate:down
DROP TABLE IF EXISTS offering_enrollments;
DROP TABLE IF EXISTS teacher_assignments;
DROP TABLE IF EXISTS offering_class_links;
DROP TABLE IF EXISTS offerings;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS curriculum_reviewers;
DROP TABLE IF EXISTS misconceptions;
DROP TABLE IF EXISTS kc_edges;
DROP FUNCTION IF EXISTS kc_edges_no_cycle();
DROP TABLE IF EXISTS requirement_kc_links;
DROP TABLE IF EXISTS kc_versions;
DROP FUNCTION IF EXISTS kc_versions_guard();
DROP TABLE IF EXISTS knowledge_components;
DROP TABLE IF EXISTS curriculum_requirements;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS guardian_links;
DROP TABLE IF EXISTS class_memberships;
DROP TABLE IF EXISTS admin_classes;
DROP TABLE IF EXISTS academic_years;
DROP TABLE IF EXISTS school_memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS schools;
DROP FUNCTION IF EXISTS touch_updated_at();
DROP FUNCTION IF EXISTS forbid_mutation();
