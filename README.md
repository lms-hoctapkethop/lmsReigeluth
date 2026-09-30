# Học cùng nhau

Repo được làm mới theo bộ đặc tả triển khai 3.0 (30/09/2026). Mốc hiện tại là **M2**: tổ chức nhà trường, nhập tài khoản, và nạp yêu cầu cần đạt.

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
