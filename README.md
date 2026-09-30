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
- Đồng hồ giả chỉ khi `NODE_ENV=test` hoặc `HCN_TEST_CLOCK=1`. Production có `HCN_NOW` hoặc `HCN_CLOCK_FILE` thì không khởi động. Tệp đồng hồ đọc tối đa một lần mỗi giây. Playwright đặt `HCN_TEST_CLOCK=1` để J04 vẫn dùng tệp.
- SEC-08 quét JSON sau khi bỏ `label`, `stem`, `openedHints`, `text` (học sinh phải thấy nhãn phương án). Vị trí phương án đúng giữ thứ tự tác giả. Phản hồi quiz có `Cache-Control: private, no-store`. Bản build bật source map `hidden`; script quét HTML, bundle và `.map`.
- Seed không có `M-TIN10-01`. J05 dùng `M-TIN10-CAULENH` ("Quên phép gán và viết dấu bằng."). `optionMisconceptions` nhận id, không nhận mã.
- Ô quiz không ghi `localStorage` hay `sessionStorage`. Tải lại gọi `startAttempt` với khóa mới và đọc `questionStates`. Ô số không điền lại nội dung đã gõ vì DTO không trả `raw`.
- Màn ≤ 640 px hiện một câu (`data-active`). Desktop hiện cả danh sách. Không đồng hồ đếm giờ, không bảng xếp hạng.

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
