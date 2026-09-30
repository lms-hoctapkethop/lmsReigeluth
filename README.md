# Học cùng nhau

Repo được làm mới theo bộ đặc tả triển khai 3.0 (30/09/2026). Mốc hiện tại là **M3**: chương trình, thành phần kiến thức, và lỗi hiểu sai.

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
- Migration mới `20261003000100_curriculum_review.sql` thêm `extraction`, `extraction_flags`, `created_by`, `curriculum_review_log` và view `effective_kc_edges`. Không sửa migration cũ. `db/tests/schema_invariants.sql` vẫn in 26 PASS; DB17–DB21 không có trong tệp đã đóng băng nên không được thêm.
- `If-Match` của YCCĐ là số micro giây của `updated_at`, hoặc dạng `W/"<số>"`.
- Học sinh và phụ huynh thấy mọi YCCĐ `approved` hoặc `source_checked` theo môn và khối. YCCĐ không gắn offering nên chưa lọc theo ghi danh.
- `can(curriculum.review)` cho phép admin và teacher bước vào use case. Dòng `curriculum_reviewers` mới quyết định 403 theo môn.
- Cạnh proposed chỉ đi qua `proposedEdgesForReview`. Publish, R0 và bản đồ nhiệt phải gọi `effectivePrerequisites`.
- CLI `grant-reviewer` / `revoke-reviewer` không có API. Vì không có phiên, actor của audit là chính user được cấp hoặc thu hồi.
- Test kết nối bằng `hcn_test_app` (thuộc `hcn_app`). Migration và seed vẫn dùng superuser. `TRUNCATE` không được GRANT thêm; chỗ dọn dữ liệu kiểm thử vẫn dùng kết nối superuser.
- Phím tắt j/k tắt bằng hộp kiểm trên trang, không ghi localStorage. Hộp thoại duyệt không bẫy focus; kết quả nằm ở vùng `aria-live`.
- Ca M3-SELF dùng `reviewer.tin` vừa là người đề xuất vừa là người duyệt. `gv.de.xuat` không có dòng `curriculum_reviewers`, nên tự duyệt của giáo viên đó dừng ở 403 trước khi tới `SELF_REVIEW`.

## Thay đổi 3.3

Mục này không có sẵn trên `main` khi bắt đầu M4. `main` mới có M1. Nhánh `m4-authoring` tách từ `m3-curriculum` vì đó mới là chỗ có M2, M3 và OpenAPI 3.2. Không có mục 5.0 hay 5.5 trong `docs/05`, và `docs/06` vẫn ghi 37 vector. Các lựa chọn dưới đây là chỗ đặc tả im lặng:

- `tests/reference/pure.reference.mjs` được thêm tham số `prereqKcs` và 2 vector (diagnostic được phép, practice thì V05). 37 vector cũ giữ nguyên kỳ vọng. Nếu không thêm, `ALL 39 PASS` là không thể. Script và Vitest đều in 39 PASS.
- Miễn V05 cho tiên quyết trực tiếp chỉ khi mục quiz có `purpose = diagnostic` và KC đó đã duyệt. Practice, exit ticket, summative vẫn bị V05.
- Rich text `hcn-rich/1`: tối đa 100 khối, đoạn 8 000 ký tự, mã 20 000, toán 2 000, href 2 000, bảng 10×10. Từ chối HTML cả trong khối `code`. Link phải là `https://` sau khi cắt khoảng trắng và ký tự điều khiển. Khối `image` trả 422 `FEATURE_NOT_ENABLED`.
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
- `db/tests/schema_invariants.sql` vẫn in 26 PASS. Ngưỡng CI không được nâng lên 36 vì không được sửa tệp kiểm thử đã đóng băng.
- Phím tắt dàn mục là Alt+Mũi tên, kèm nút Lên/Xuống. Không ghi localStorage.

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
