-- migrate:up
-- Học cùng nhau 3.5 · 0007 chốt chặn tệp ở DB (bổ sung cho 0006 đã merge; không sửa 0006).
-- 1) Tệp gắn vào phiên bản bài nộp: của chính HS, cùng trường, đã quét clean.
-- 2) content_files thuộc nội dung đã phát hành: bất biến; hcn_app chỉ SELECT, INSERT.
-- 3) content_files chỉ nhận ảnh png/jpeg/webp đã clean.

CREATE OR REPLACE FUNCTION submission_version_files_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  SELECT (f.owner_id = s.learner_id AND f.school_id = s.school_id AND f.scan_status = 'clean')
    INTO ok
    FROM submission_versions v
    JOIN submissions s ON s.id = v.submission_id
    JOIN files f ON f.id = NEW.file_id
   WHERE v.id = NEW.submission_version_id;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'SUBMISSION_FILE_INVALID: file % must belong to the learner, same school, scan_status clean', NEW.file_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_version_files_check BEFORE INSERT ON submission_version_files
  FOR EACH ROW EXECUTE FUNCTION submission_version_files_check();

CREATE OR REPLACE FUNCTION content_files_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM files f
                  WHERE f.id = NEW.file_id AND f.scan_status = 'clean'
                    AND f.mime_detected IN ('image/png','image/jpeg','image/webp')) THEN
    RAISE EXCEPTION 'CONTENT_FILE_INVALID: file % must be a clean png, jpeg or webp image', NEW.file_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_files_check BEFORE INSERT ON content_files
  FOR EACH ROW EXECUTE FUNCTION content_files_check();
CREATE TRIGGER content_files_immutable BEFORE UPDATE OR DELETE ON content_files
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

REVOKE UPDATE, DELETE ON content_files FROM hcn_app;

-- migrate:down
GRANT UPDATE, DELETE ON content_files TO hcn_app;
DROP TRIGGER IF EXISTS content_files_immutable ON content_files;
DROP TRIGGER IF EXISTS content_files_check ON content_files;
DROP FUNCTION IF EXISTS content_files_check();
DROP TRIGGER IF EXISTS submission_version_files_check ON submission_version_files;
DROP FUNCTION IF EXISTS submission_version_files_check();
