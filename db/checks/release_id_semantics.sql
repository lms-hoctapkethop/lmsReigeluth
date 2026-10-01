-- Chỉ đọc. Diễn tập REL-06 chụp release_id_snapshot trước migrate up.
-- Cột snapshot: source, id, module_release_id, module_version_id.
-- module_version_id lấy từ module_releases tại thời điểm chụp.
\set ON_ERROR_STOP on
DO $$
DECLARE
  drifted bigint;
BEGIN
  IF to_regclass('release_id_snapshot') IS NULL THEN
    RAISE EXCEPTION 'Thiếu release_id_snapshot';
  END IF;
  SELECT count(*) INTO drifted
  FROM (
    SELECT s.id, s.module_release_id, r.module_version_id
    FROM submissions s
    JOIN module_releases r ON r.id = s.module_release_id
    UNION ALL
    SELECT q.id, q.module_release_id, r.module_version_id
    FROM quiz_attempts q
    JOIN module_releases r ON r.id = q.module_release_id
    UNION ALL
    SELECT a.id, a.module_release_id, r.module_version_id
    FROM activity_progress a
    JOIN module_releases r ON r.id = a.module_release_id
  ) current
  JOIN release_id_snapshot snap ON snap.id = current.id
  WHERE current.module_release_id IS DISTINCT FROM snap.module_release_id
     OR current.module_version_id IS DISTINCT FROM snap.module_version_id;
  IF drifted > 0 THEN
    RAISE EXCEPTION 'release_id lệch % hàng', drifted;
  END IF;
  RAISE NOTICE 'PASS release_id_semantics';
END $$;
