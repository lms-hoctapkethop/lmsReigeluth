# Học cùng nhau

Repo được làm mới theo bộ đặc tả triển khai 3.0 (30/09/2026). Mốc hiện tại là **M6**: quiz.

## Thay đổi 3.1

Mục này không có sẵn trong cây nguồn trước M2. Các khóa dưới đây lấy từ lời giao M2 và những chỗ đặc tả im lặng:

- `gv.lan` chỉ là giáo viên. Hành trình J01 đăng nhập bằng `gv.lan.ph`.
- Mã lớp học phần trong cơ sở dữ liệu viết hoa (`TIN10A1`); tên hiển thị giữ dạng `Tin10A1`.
- Khi bảng persona không ghi capability, seed dùng `teach, author, release, review`. `view` chỉ gắn khi bảng ghi rõ.
- Migration không có `unaccent`. Tìm người dùng bỏ dấu bằng `translate`, không thêm migration.
- Bảng `users` không có cột username. Mã định danh nằm ở Keycloak; dòng `users` nối bằng `oidc_subject`.
- `details` của audit chỉ có id và trạng thái. Lý do khóa được kiểm ở API nhưng không ghi vào audit vì không có cột và không được thêm migration. Lý do thu hồi liên kết nằm ở `guardian_links.revoke_reason`.
- Trùng mã offering trong một năm trả `409 REVISION_CONFLICT`. Trùng thời gian phân công trả `409 ASSIGNMENT_OVERLAP`.
- Lệnh tổ chức phát outbox id-only. `GuardianLinkRevoked` theo docs/05. Các lệnh khác dùng tên `OfferingCreated`, `TeacherAssigned`, `LearnersEnrolled`, `UsersImported`, …
- Nếu hôm nay không rơi vào năm học nào, nhập lớp lấy năm có `ends_on` muộn nhất.
- Phát lại import cùng khóa trả `passwordsRedacted: true` và không kèm `temporaryPassword`. Bản ghi idempotency cũng không chứa mật khẩu.
- Persona `admin.truong` của M1 được thay bằng `admin.a`, cùng subject `10000000-0000-4000-8000-000000000014`.
- Liên kết phụ huynh trường Bình (`gv.b` → `hs.b`) chỉ là mốc IDOR. `gv.b` không có membership guardian.
- Seed chương trình gộp khối của môn đã có, không thay cả mảng khi tệp chỉ chứa một phần khối. Hàng `review_status = approved` không bị ghi đè.
- `listSchoolUsers` gom vai trò trong bộ nhớ rồi phân trang bằng con trỏ base64url `{n, i}`. Quy mô pilot đủ nhỏ cho cách này.
- OpenAPI được thêm các đường admin mà giao diện `/quan-tri` gọi. `ASSIGNMENT_OVERLAP` được thêm vào enum lỗi.
- `testcontainers` là devDependency trực tiếp của `@hcn/api` vì đã có trong lockfile qua `@testcontainers/postgresql`. Không thêm thư viện khác.
- CI chạy khi đẩy nhánh `m2-org`, cùng lý do với `m1-auth`: review PR không kích hoạt GitHub Actions.

## Thay đổi 3.2

Mục này không có sẵn trên `main` khi bắt đầu M3. Các lựa chọn dưới đây là chỗ đặc tả im lặng:

- Nhánh `m3-curriculum` tách từ `m2-org` vì `main` mới có M1, chưa có tổ chức M2 và chưa có tệp spec 3.2.
- Migration `20261003000100_curriculum_review.sql` thêm `extraction`, `extraction_flags`, `created_by`, `curriculum_review_log` (`from_status`, `to_status`, nhật ký append-only) và view `effective_kc_edges`. `hcn_app` chỉ được `SELECT, INSERT` trên nhật ký. Hàm `kc_edges_no_cycle` bỏ qua version `superseded`/`rejected`.
- `If-Match` của YCCĐ là số micro giây của `updated_at`, hoặc dạng `W/"<số>"`.
- Học sinh chỉ thấy YCCĐ `approved` hoặc `source_checked` khi `(subject_code, grade)` thuộc khóa của offering mình đang ghi danh `active`. Phụ huynh thấy theo con có liên kết `verified`.
- `can(curriculum.review)` cho phép admin và teacher bước vào use case. Dòng `curriculum_reviewers` mới quyết định 403 theo môn.
- Cạnh proposed chỉ đi qua `proposedEdgesForReview`. Publish, R0 và bản đồ nhiệt phải gọi `effectivePrerequisites`.
- CLI `grant-reviewer` / `revoke-reviewer` không có API. Audit ghi `actor_id` null, `details` là `{via: "cli", os_user}`, đối tượng là user được cấp hoặc thu hồi. `--granted-by <username>` bắt buộc và điền `curriculum_reviewers.granted_by`.
- Test kết nối bằng `hcn_test_app` (thuộc `hcn_app`). Migration và seed vẫn dùng superuser. `TRUNCATE` không được GRANT thêm; chỗ dọn dữ liệu kiểm thử vẫn dùng kết nối superuser.
- Phím tắt j/k tắt bằng hộp kiểm trên trang, không ghi localStorage. Hộp thoại duyệt không bẫy focus; kết quả nằm ở vùng `aria-live`.
- Ca M3-SELF dùng `reviewer.tin` vừa là người đề xuất vừa là người duyệt. `gv.de.xuat` không có dòng `curriculum_reviewers`, nên tự duyệt của giáo viên đó dừng ở 403 trước khi tới `SELF_REVIEW`.

## Thay đổi 3.3

Mục này không có sẵn trên `main` khi bắt đầu M4. `main` mới có M1. Nhánh `m4-authoring` tách từ `m3-curriculum` vì đó mới là chỗ có M2, M3 và OpenAPI 3.2. Không có mục 5.0 hay 5.5 trong `docs/05`, và `docs/06` vẫn ghi 37 vector. Các lựa chọn dưới đây là chỗ đặc tả im lặng:

- `tests/reference/pure.reference.mjs` được thêm tham số `prereqKcs` và 2 vector (diagnostic được phép, practice thì V05). 37 vector cũ giữ nguyên kỳ vọng. Nếu không thêm, `ALL 39 PASS` là không thể. Script và Vitest đều in 39 PASS.
- Miễn V05 cho tiên quyết trực tiếp chỉ khi mục quiz có `purpose = diagnostic` và KC đó đã duyệt. Practice, exit ticket, summative vẫn bị V05.
- Rich text `hcn-rich/1`: tối đa 100 khối, đoạn 8 000 ký tự, mã 20 000, toán 2 000, href 2 000, bảng 10×10. Từ chối HTML cả trong khối `code`. Link phải là `https://` sau khi cắt khoảng trắng và ký tự điều khiển. Khối `image` ở M4 trả 422 `FEATURE_NOT_ENABLED`. Từ M5 khối ảnh được bật, xem mục Thay đổi M5.
- KaTeX 0.18 với `trust: false` vẫn render `\href` và `\url`, và chỉ cảnh báo `\htmlClass`. Bộ phân tích chặn ba lệnh đó trên nguồn TeX trước khi gọi `renderToString(..., { trust: false, throwOnError: true })`.
- `If-Match` của bản nháp là số revision (`W/"<n>"` hoặc chữ số), không phải micro giây của `updated_at`.
- Trường `source`, `approvedBy`, `provisional` bị từ chối ở schema nhận vào. Khi lưu, câu mới nhận `source=teacher`, `provisional=false`. Câu đã có trong DB giữ các trường server theo `clientKey`, kể cả câu `ai_proposal` do superuser chèn. Phản hồi GET/PUT gỡ các trường đó để vòng lưu tiếp không bị 422.
- `kcObservable`, `kcRequired` và KC của rubric phải là version `approved`. Lỗi hiểu sai phải `approved` và thuộc KC của một KC observable trong câu.
- YCCĐ của module phải `approved` và cùng môn, cùng khối với khóa học.
- Quiz không phải `practice` mà bật `hintsEnabled` thì 422. Cột DB cấm gợi ý ngoài practice.
- Digest là `sha256` của JCS (RFC 8785) sau khi bỏ mọi `clientKey`. Trường server còn trong payload đã lưu vẫn nằm trong digest.
- Khóa idempotency băm `expectedRevision` và `acknowledgements`, không băm cả bản nháp. Cùng khóa và cùng body trả lại version đã tạo. Body khác thì 409 `IDEMPOTENCY_KEY_REUSED`. Khóa khác nhưng cùng digest với version mới nhất thì 409 `ALREADY_PUBLISHED`.
- `listMyModules` chỉ trả module trong khóa mà giáo viên là chủ hoặc collaborator editor, và có phân công `author`. `module.create/edit/publish` từ chối admin, học sinh, phụ huynh.
- `toLearnerRelease` là hàm duy nhất chiếu DTO học sinh. Xem trước gọi hàm này và không ghi tiến độ.
- Ngân sách gzip 250 KB áp cho tệp mà `index.html` tải ngay (lộ `/hoc`). Studio, KaTeX và kéo thả được tách chunk, không tính vào ngân sách đó.
- `db/tests/schema_invariants.sql` không sửa. `db/tests/curriculum_review_invariants.sql` giữ 10 ca DB17–DB21d của đặc tả 3.3; chỉ tên cột được đổi theo migration 0005 của repo. Ngưỡng CI từ M5 là 52 PASS trên `invariants.log`.
- Phím tắt dàn mục là Alt+Mũi tên, kèm nút Lên/Xuống. Không ghi localStorage.

## Thay đổi M5

Không có gói đặc tả 3.4 trong repo hay bản chụp Drive. Migration `0006` và `db/tests/learning_invariants.sql` (DB22–DB26) được viết từ prompt M5 và CHECK đã có ở migration 0002–0003. Các file bất biến cũ không sửa. Ngưỡng CI là 52 PASS.

- `submission` trên nhiệm vụ là tùy chọn. Khi thiếu, học sinh nhận mặc định `{ types: ['text'], allowFiles: false, maxFiles: 0 }`. Cột `submission_config` để NULL trong trường hợp đó.
- ZIP bị từ chối đến M10. Allowlist hiện tại là pdf, png, jpeg, webp, txt, py, docx, xlsx, pptx. Tệp rỗng là `VALIDATION_FAILED` với `reason = EMPTY_FILE`.
- `GET /files/{id}?disposition=inline` chỉ dành cho ảnh mà người gọi được xem. Mọi tải xuống khác là `attachment`. Cả hai đều có `nosniff` và `Content-Security-Policy: sandbox`. Tên tệp theo RFC 5987.
- Chủ tệp xem được meta kể cả khi `infected`. Tải xuống tệp `infected` hoặc `error` luôn 404. `pending` khi tải xuống là 423.
- Quét lỗi: consumer `files.scan` thử 3 lần rồi đặt `scan_status = error` và đánh dấu sự kiện done. Consumer khác chết sau 8 lần. Sự kiện không có consumer được đánh dấu done.
- Giờ mở bài so với `Meta.clock`. Đồng hồ đọc `HCN_CLOCK_FILE` rồi `HCN_NOW`, không theo đồng hồ trình duyệt. `submitted_at` và `is_late` vẫn là `now()` của Postgres.
- Nộp bài chỉ nhận `draftRevision`. Nội dung và `fileIds` lấy từ nháp trên server. Băm nội dung là JCS của nháp đó.
- HS sai ghi danh hoặc chưa tới giờ mở nhận 404, không phải 403. 410 chỉ khi nộp sau `accept_until`, hoặc sau `due_at` với `late_policy = reject`.
- Tự lưu trên web là 2 giây. Mất mạng hiện đúng câu "Chưa lưu, đang thử lại". Không ghi bài vào localStorage hay sessionStorage. Soạn mã là textarea có số dòng, không chạy mã. Bài dạng rich là một đoạn, không mở studio.
- `Idempotency-Key` của hộp giao bài sinh một lần mỗi lần mở hộp. Ngày giờ trên form hiểu là `Asia/Ho_Chi_Minh`.
- `GET /api/v1/curriculum/kcs` (`listKcs`) chưa có route. Giữ trong OpenAPI với `x-milestone: M3` để OA-02 bỏ qua và không xóa path khỏi hợp đồng.
- Thêm mã `FILE_REJECTED` (422). Worker được `DELETE` trên `idempotency_keys` và `sessions` để dọn hàng giờ.
- Ảnh trong học liệu phải cùng trường và `scan_status = clean` lúc phát hành, nếu không thì 422 `VALIDATION_FAILED` với `details.reason = IMAGE_NOT_CLEAN`.

## Thay đổi M6

Không có gói đặc tả 3.5, không có mục README "Thay đổi 3.5", và `docs/05` không có mục 8.0 (chỉ có mục 8 rồi 8.1–8.4). `AGENTS.md` mục 7 lúc bắt đầu chưa nói `db/SPEC_SHA256SUMS`. Các lựa chọn dưới đây là chỗ đặc tả im lặng hoặc chỗ prompt M6 khác tài liệu cũ:

- Không thêm migration. Bảng quiz đã có từ migration 0003. Kysely được khai báo tay cho `quiz_attempts`, `question_responses`, `attempt_hint_usage`, `attainment_decisions`. Không chạy `kysely-codegen`.
- `db/SPEC_SHA256SUMS` chỉ khóa các tệp đã đóng trước M6: migration, ba tệp bất biến cũ, và `tests/reference/pure.reference.mjs`. `db/tests/quiz_invariants.sql` là tệp mới (DB27–DB29, 22 PASS). Ngưỡng CI là 78 PASS, cao hơn mức tối thiểu 66.
- `gradeResponse` và `normalizeNumber` giữ nguyên bản M0. 39 vector không đổi.
- `question_keys` chỉ đọc qua `readQuestionKey`. ESLint cấm import hàm đó ngoài `answer.ts` và `submit.ts`. `hcn_app` vẫn được SELECT vì migration 0004 đã GRANT; worker vẫn bị REVOKE. Không GRANT thêm.
- Khóa idempotency: `start:<releaseId>:<itemId>`, `answer:<attemptId>:<questionId>`, `submit:<attemptId>`. `requestHint` không có khóa. Cùng key và cùng body trả receipt cũ.
- Mọi lệnh ghi của lượt khóa `quiz_attempts` bằng `FOR UPDATE`. `try_no` lấy max+1 trong khóa đó. Câu trả lời chỉ INSERT, không UPDATE.
- Practice đã đúng thì 409 `ALREADY_ANSWERED` với `details.reason = ALREADY_CORRECT` (docs/05 8.2 ghi `VALIDATION_FAILED` / `ALREADY_ANSWERED_CORRECTLY`). Đã nộp: `SUBMITTED`. Hết gợi ý: `NO_MORE_HINTS`. Gợi ý khi không phải practice: `HINTS_DISABLED`.
- Practice luôn hiện đúng/sai, kể cả khi `show_feedback = never`, và không trả đáp án. Mục đích khác: `never` không lộ; `immediate` lộ ngay; `after_submit` chỉ sau nộp; `after_due` chỉ khi đã nộp, có `due_at`, và `now` sau hạn. Không có hạn thì `after_due` không lộ.
- `max_attempts` null của diagnostic và exit ticket được hiểu là 1. Practice, self-assessment và summative null là không giới hạn.
- `startAttempt` trả 201 cả khi nối lại lượt `in_progress`. Lượt diagnostic đã hết hạn mức trả 409 `ATTEMPT_LIMIT_REACHED`; giao diện hiện "Đã hoàn thành".
- `toLearnerAttempt` là hàm duy nhất chiếu DTO học sinh. Thêm `questionStates` (OpenAPI trước đó chỉ có `answered`). Không trả `answerKey`, `rationale`, `correctAnswer`, `optionMisconceptions`, `kcRequired`, `kcObservable`. `GET` bài học chỉ còn `hintsAvailable`, không còn văn bản gợi ý chưa mở.
- Body `notLearned: true` chỉ hợp lệ ngoài practice. Diagnostic ghi `correct` NULL, vẫn tính vào `max_score`, điểm câu đó là 0. Practice trả 422 `VALIDATION_FAILED` reason `NOT_LEARNED` và không ghi hàng.
- `minScore`, `min_score`, `kcGate`, `kc_gate`, `gate` → 422 `FEATURE_NOT_ENABLED` reason `MIN_SCORE_OR_KC_GATE`. Không có cột schema. `decision`, `attainment`, `attainmentDecision` → 422 reason `ATTAINMENT`. Không ghi `attainment_decisions`.
- `correct` hoặc `score` ở body trả lời bị zod từ chối 422, không ghi `question_responses`.
- Số sai định dạng (`1.000`, rỗng, chữ, `1/0`) là 422 `VALIDATION_FAILED`; `details.message` là "Em nhập số thập phân bằng dấu phẩy, ví dụ 1,5". Web hiện đúng câu đó dưới ô. Dấu trừ U+2212 được nhận.
- Điểm lượt là tổng `gradeResponse` của lần trả lời cuối mỗi câu, làm tròn 3 chữ số. `max_score` là số câu. `submitted_at` và `activity_progress.completed_at` lấy `Meta.clock`, khác bài tập M5 vốn dùng `now()` của Postgres. Hoàn thành khi nộp, bất kể điểm. Không ghi audit cho quiz.
- Outbox `QuestionAnswered` có `responseIds` là chuỗi id cách nhau bằng dấu phẩy vì payload outbox là `Record<string, string>`. Practice phát lúc trả lời. Mục đích khác phát lúc nộp. Không có consumer M7/M8.
- `answerQuestion` và `requestHint` mỗi loại 60 lần/phút/người, nhóm rate-limit riêng, không cộng vào trần 120 của lệnh ghi.
- `UPSTREAM_IDP_ERROR` (502) khi `importUsers` gặp Keycloak `unavailable`. Timeout từng dòng vẫn là `IDP_TIMEOUT` trong kết quả lô, không đổi ca import cũ. Ca 502 dùng app riêng vì app dùng chung đã hết 5 lần import mỗi giờ.
- Quiz chỉ có câu trắc nghiệm trên YCCĐ Bloom từ 5 trở lên bị cảnh báo V02 (chưa có sản phẩm). Phát hành phải kèm acknowledgement `{ code: 'V02', target: requirementId, reason }`.
- Đồng hồ giả chỉ khi `NODE_ENV=test` hoặc `HCN_TEST_CLOCK=1`. Production có `HCN_NOW` hoặc `HCN_CLOCK_FILE` thì không khởi động. Tệp đồng hồ đọc tối đa một lần mỗi giây. Playwright đặt `HCN_TEST_CLOCK=1` để J04 vẫn dùng tệp. J04 chờ 1,2 giây sau khi đổi giờ trước lần tải tiếp theo. Cùng cờ đó nới giới hạn `/auth/*` trong tiến trình API của E2E: bộ hành trình đăng nhập hơn 20 lần trong một phút từ một IP, còn production giữ 20 request/phút/IP.
- SEC-08 quét JSON sau khi bỏ `label`, `stem`, `openedHints`, `text` (học sinh phải thấy nhãn phương án). Vị trí phương án đúng giữ thứ tự tác giả. Phản hồi quiz có `Cache-Control: private, no-store`. Bản build bật source map `hidden`; script quét HTML, bundle và `.map`.
- Seed không có `M-TIN10-01`. J05 dùng `M-TIN10-CAULENH` ("Quên phép gán và viết dấu bằng."). `optionMisconceptions` nhận id, không nhận mã.
- Ô quiz không ghi `localStorage` hay `sessionStorage`. Tải lại gọi `startAttempt` với khóa mới và đọc `questionStates`. Ô số không điền lại nội dung đã gõ vì DTO không trả `raw`.
- Màn ≤ 640 px hiện một câu (`data-active`). Desktop hiện cả danh sách. Không đồng hồ đếm giờ, không bảng xếp hạng.

## Thay đổi 3.6

Đặc tả cho M7, viết trên `main` 79d1c56. Gói 3.5 trước đó chưa vào repo nên 3.6 gồm cả phần của 3.5.

- Migration 0007 `20261005000100_file_guards.sql`:
  - tệp gắn bài nộp phải của chính HS, cùng trường, `clean`;
  - `content_files` chỉ nhận ảnh sạch và bất biến; thu hồi quyền UPDATE, DELETE của `hcn_app`.
- Migration 0008 `20261006000100_review_guards.sql`:
  - kết quả tiêu chí của review đã công bố bất biến;
  - quyết định mức đạt chỉ dựa trên review của chính HS, đúng offering;
  - một quyết định gốc cho mỗi (HS, offering, YCCĐ), chuỗi thay thế không đổi đối tượng;
  - đồng hành gia đình chỉ `committed → cancelled`;
  - `hcn_app` chỉ đổi `notifications.read_at`.
- Tệp bất biến `file_guards_invariants.sql` (DB30–DB32) và `review_guards_invariants.sql` (DB33–DB37). CI yêu cầu ≥ 101 PASS. Cả hai migration và hai tệp test có trong `db/SPEC_SHA256SUMS`.
- `docs/05` đồng bộ với code: mục 4, 5.0, 5.5, 6.0, 7.0 (quyết định đã chốt ở 3.2–3.4), 8.0 (ghi đúng hành vi quiz M6), 9.0 (M7: hàng chờ, nháp review, công bố và khóa, thay quyết định, hồ sơ, cổng PH, đồng hành, thông báo, worker an toàn khi sập). `docs/02`, `03`, `06`, `09` cập nhật theo.

## Thay đổi M7

Đặc tả 3.6 đã ở `main`. Phần dưới là chỗ mã M7 phải chọn vì tài liệu im lặng hoặc hai chỗ nói khác nhau:

- Không thêm migration. Bảng review, quyết định, đồng hành, thông báo đã có từ 0003 và 0008. Chỉ bổ sung kiểu Kysely. Không sửa tệp trong `db/SPEC_SHA256SUMS`.
- `docs/07` ghi cổng phụ huynh là `/gia-dinh`. Màn hình dùng `/phu-huynh`; `/gia-dinh` mở cùng màn. Menu trỏ `/phu-huynh`.
- OpenAPI bắt `decisions[].reason` tối thiểu 3 ký tự mọi lần công bố. `docs/05` 9.0 chỉ bắt lý do khi đã có quyết định hiện hành. Mã theo OpenAPI.
- `docs/05` 9.3 viết `expectedRevision` khớp thì 409. Mã hiểu là lệch revision thì 409 `REVISION_CONFLICT`.
- Hàng chờ thêm query `late` và `itemId` vì mục 9.0 yêu cầu lọc theo mục và muộn, còn OpenAPI lúc đầu chỉ có `status`, `cursor`, `limit`.
- `publishReview` chỉ ghi quyết định gốc (`supersedes_id` null). Nếu đã có quyết định hiện hành cho cùng (HS, offering, YCCĐ), kể cả khi hai công bố chạy nối tiếp, request trả 409 `REVISION_CONFLICT` reason `DECISION_CHANGED`. Đổi quyết định đã có đi qua `supersedeDecision`. Mục 9.3 bước 4 nói công bố nối vào hiện hành; mã tách việc đó sang supersede để ca song song luôn còn đúng một gốc.
- `getLearnerNeeds` và heatmap giữ `x-milestone: M7`, chưa có route.
- `GET` bài nộp của phụ huynh trả `body: null` và `fileIds: []`.
- Thông báo `ReleaseCreated` trỏ `/hoc/lop/:offeringId`. `ReviewPublished` và `DecisionSuperseded` trỏ `/hoc/ho-so/:offeringId` cho học sinh và `/phu-huynh/con/:learnerId` cho phụ huynh đã xác minh. Payload chỉ `{title, href}`.
- `due_soon` là một thông báo cho mỗi (đợt, mục, học sinh), `source_event` là UUID v5 namespace `8c1e5b2a-4d77-5f10-9a33-6e0c1b7d4a21`. Học sinh đã có `current_version_no > 0` không nhận.
- Consumer `insight.*` chưa làm. Sự kiện không có consumer vẫn được đánh dấu `done`, như M5.
- Worker ghi `processed_events` rồi mới đánh dấu outbox `done`, hai commit tách nhau để ca sập giữa chừng không nhân đôi thông báo. Hàng outbox vẫn bị khóa `FOR UPDATE` đến khi cập nhật trạng thái, nên hai worker không xử lý trùng.
- `reviewer_id` là người lưu nháp gần nhất. Audit `review.publish` ghi người công bố, không ghi nội dung nhận xét.

## Thay đổi 3.7

Đặc tả cho M8 (nền dữ liệu chẩn đoán), viết trên `main` 6b7a902.

- Migration 0009 `20261007000100_insight_guards.sql`:
  - `question_responses.points` (0..1) để quan sát giữ đúng điểm lẻ của multi_choice `partial`; worker không đọc `question_keys` nên không thể tự chấm lại;
  - thu hồi quyền ghi `observations`, `needs_estimates`, `misconception_signals` của `hcn_app`, chỉ worker ghi;
  - `needs_estimates` chỉ thêm;
  - view `needs_current_kc` gộp ước lượng theo KC qua mọi version.
- `db/tests/insight_guards_invariants.sql` (DB38–DB41). CI yêu cầu ≥ 111 PASS; hai tệp có trong `db/SPEC_SHA256SUMS`.
- `docs/06`:
  - 3.0: điểm câu, nguồn quan sát, backfill cho dữ liệu M6–M7 mà worker đã đánh dấu `done`;
  - 4: R0 theo KC, chỉ INSERT khi đổi, đổi mô hình giữ lịch sử;
  - 8: cột, thứ tự, ô `insufficient`, `rootGaps`, `includeValues` chỉ cho GV.
- `docs/05` mục 11.0: role worker, tín hiệu lỗi hiểu sai, tắt AI, quyền đọc nhu cầu.
- `openapi.yaml` 3.7.0: `getLearnerNeeds`, `getHeatmap` chuyển `x-milestone` sang M8 (M8 gỡ khi cài route); heatmap thêm `includeValues`, `value`, `rootGaps`, `modelVersion`.
- Ghi nhận từ M7: `publishReview` chỉ ghi quyết định gốc; đổi quyết định đã có đi qua `supersedeDecision` (README "Thay đổi M7"). Đặc tả chấp nhận cách này.

## Thay đổi M8

Nền dữ liệu chẩn đoán: quan sát, R0, bản đồ nhiệt. Worker chạy bằng `WORKER_DATABASE_URL` (login thuộc nhóm `hcn_worker`). `FEATURE_AI` mặc định tắt; không có client LLM.

- Chấm M6 ghi `question_responses.points` (0..1, 3 chữ số) lúc INSERT khi `correct` khác NULL. `multi_choice` `partial` ghi điểm lẻ, `correct` là false nếu điểm khác 1. `submit` cộng `points` đã lưu; chỉ đọc `question_keys` khi `points` còn NULL (hàng cũ).
- Worker:
  - `insight.deriveObservations` từ `QuestionAnswered` và `ReviewPublished` (docs/06 mục 3.0–3.2), `ON CONFLICT DO NOTHING`, rồi phát `ObservationsAdded`.
  - `insight.recomputeNeeds` gộp mọi version của một KC, gọi `r0Estimate`, INSERT chỉ khi `status` hoặc `value` đổi. Hằng `R0_MODEL_VERSION = 'R0@1.0.0'`.
  - `insight.updateMisconceptionSignals` theo docs/05 mục 11.0. Chạy trên `QuestionAnswered` (kể cả câu không có KC observable). `resolved` không bị ghi đè.
  - `pnpm insight:backfill` và `pnpm insight:recompute --model <ver>`.
- Payload `ObservationsAdded` dùng `kcIds` (id của knowledge component), đúng docs/06 mục 3.0. Bảng sự kiện ở docs/05 mục 1 ghi `kcVersionIds` và liệt kê `updateMisconceptionSignals` là consumer của sự kiện này; code không làm vậy vì ước lượng tính theo KC, còn tín hiệu lỗi hiểu sai cần `responseIds`.
- Migration mới `db/migrations/20261008000100_worker_outbox_insert.sql`: `GRANT INSERT ON outbox_events TO hcn_worker`. 0004 chỉ cho UPDATE các cột trạng thái, không cho INSERT, nên worker không phát được `ObservationsAdded` trong cùng transaction với quan sát. Không sửa migration đã merge, không đụng `db/SPEC_SHA256SUMS`.
- API: `getLearnerNeeds` (GV có `value`; HS chỉ nhãn chữ, không có khóa `value`; PH và người khác 404), `getHeatmap` (`includeValues`, `rootGaps`, `modelVersion`, `lastUpdatedAt`). Đã gỡ `x-milestone: M8` của hai thao tác này. `healthReady` vẫn để M8.
- Ước lượng không ghi `attainment_decisions`.
- Web: `/day/lop/:id` tab Bản đồ nhiệt (HS × KC theo thứ tự tô-pô, bốn trạng thái có chữ và màu, công tắc "Hiện giá trị số", nhóm hổng gốc, "Nên trao đổi trực tiếp" khi `capped`, "cập nhật lúc…"). Hồ sơ HS có mục "Nhu cầu" tách khỏi "Kết luận của GV".
- Chạy worker: `WORKER_DATABASE_URL=... pnpm worker`. `WORKER_HEALTH_PORT` (ví dụ 4391) chỉ bật khi cần kiểm tra sống, phục vụ E2E.

## Thay đổi 3.8.2

Thêm `docs/08` mục 0.16 (X01–X08) sau lần review thứ hai PR #7:

- entry export `APP_VERSION` khi gọi compose;
- override riêng cho diễn tập: không publish cổng, tắt `archive_mode` để không đẩy WAL vào kho S3 của staging;
- diễn tập dùng bí mật ký gửi;
- pgBackRest restore chạy trước khi khởi động DB;
- sửa đường dẫn restore của restic;
- đo RPO;
- REL-06 tạo snapshot trước migrate;
- job `drill-e2e` chạy với MinIO trên runner.

## Thay đổi 3.8.1

Sau khi review PR #7 (M9), thêm `docs/08` mục 0.15. Các điểm chính:

- Giữ `SSH_ORIGINAL_COMMAND` qua `sudo`.
- Entry không chạy script và không đọc `images.lock` của release.
- Kiểm `RepoTags` trước `docker load`.
- `policy-check` chặn thêm volume, network và namespace dùng chung với site trường.
- Compose staging trỏ secret về `/opt/hcn-staging/secrets`.
- Preflight kiểm trùng subnet.
- Workflow chặn `workflow_run` từ fork và `sha` ngoài `main`.
- Mẫu nginx sinh đủ dải IP Cloudflare.
- Bảo trì restic.
- Perf giữ kết quả, mỗi VU đăng nhập một lần, gọi API thật.
- Seed có lịch sử; drill và REL-01…04 phải cài thật.

## Thay đổi 3.8

Đặc tả cho M9 (sẵn sàng vận hành), viết trên `main` cdaff8c.

- `docs/08` mục 0 (mới): staging trên VPS đang chạy site trường.
  - Tên miền `staging-lms.hoctapkethop.edu.vn` và `id-staging-lms.hoctapkethop.edu.vn`, đi qua Cloudflare proxy rồi reverse proxy của host (chứng chỉ Origin CA, khóa sinh trên VPS) tới `127.0.0.1:18080`.
  - Deploy: GitHub Actions qua SSH, dùng khóa `restrict,command=` tới một entry chạy bằng root, có danh sách lệnh và kiểm chính sách compose.
  - Sao lưu: pgBackRest repo2 và restic ra kho S3 đặt tại Việt Nam; bí mật được ký gửi ngoài máy.
  - `/metrics` trên listener riêng.
  - Dữ liệu tổng hợp 1 215 HS; k6 chạy trong khung đêm, có vòng bảo vệ site trường.
  - Diễn tập khôi phục và REL-06 chạy trong project `hcn-drill`.
- `db/tests/ops_invariants.sql` (DB42–DB46): worker INSERT được `outbox_events`; bề mặt ghi của worker theo danh sách cho phép; worker không đọc `question_keys`; `hcn_readonly` không ghi; không role nào được TRUNCATE. CI yêu cầu ≥ 116 PASS và chạy bước này với `pipefail`. Thêm tệp này cùng migration `20261008000100_worker_outbox_insert.sql` (M8) vào `db/SPEC_SHA256SUMS`.
- Đồng bộ với M8: payload `ObservationsAdded` là `kcIds`, và consumer duy nhất là `recomputeNeeds`; `updateMisconceptionSignals` nghe `QuestionAnswered` và không cần KC observable (`docs/05` mục 1 và 11.0, `docs/06` mục 3.0).
- `openapi.yaml` 3.8.0: `healthReady` có schema `{status, checks}`, `x-milestone: M9`.
- `docs/09`: ghi chú PERF/REL cho staging dùng chung máy; G4 thêm hai điều kiện: quyết định về Cloudflare proxy cho production và bucket sao lưu production đặt tại Việt Nam.
- `docs/10` M9 viết lại; `AGENTS.md` duyệt các công cụ vận hành.

## Chạy

```bash
pnpm install
pnpm verify
pnpm dev
```

`pnpm dev` mở API tại http://127.0.0.1:4319/health/live. Giao diện: `pnpm --filter web dev` tại http://localhost:5173.

`pnpm db:migrate` cần lệnh `dbmate` và `DATABASE_URL`. DB01–DB16 chạy trên Postgres 18 trong CI, hoặc trên Postgres cài sẵn (schema không dùng tính năng riêng của 18). `packages/testkit` chỉ mở Postgres 18 khi có Docker và `dbmate`; không có Docker thì ca đó được bỏ qua ở máy local và bắt buộc phải chạy trên CI.

`pnpm db:seed:test` nạp persona docs/09 vào DB dev (cần `DATABASE_URL` và `OIDC_ISSUER`), chạy lại không tạo trùng. `pnpm db:seed:curriculum` nạp `db/seeds/curriculum_requirements.csv`.

Node đích của đặc tả là 26 sau khi vào LTS. M2 đang chạy trên Node 22.

## Tài liệu

Luật viết mã: `AGENTS.md`. Lộ trình: `docs/10-lo-trinh-cho-cursor.md`.
