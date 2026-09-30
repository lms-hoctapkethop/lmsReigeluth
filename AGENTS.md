# AGENTS.md · Luật cho AI viết mã trong repo Học cùng nhau

Tệp này áp dụng cho mọi tác tử AI (Cursor, Claude Code, Copilot) và người viết mã. Khi luật ở đây mâu thuẫn với một gợi ý trong chat, **luật ở đây thắng**; dừng lại và hỏi người điều phối.

## 1 Dự án

LMS "Học cùng nhau" cho trường phổ thông Việt Nam theo CT GDPT 2018. Người dùng: học sinh (HS), giáo viên (GV), phụ huynh (PH), quản trị trường. Mô hình sư phạm: bốn chức năng Reigeluth (lưu hồ sơ, lập kế hoạch, hỗ trợ dạy học, đánh giá). Giao diện tiếng Việt; mã, tên bảng, tên biến tiếng Anh.

## 2 Stack (không đổi nếu chưa có ADR)

- Node.js 26 LTS, pnpm workspaces, TypeScript `strict: true`, ESM.
- `apps/api`: Fastify 5, zod + `fastify-type-provider-zod`, Kysely + `pg`, `openid-client` 6.
- `apps/worker`: cùng mã domain, tiến trình riêng, đọc `outbox_events`.
- `apps/web`: React 19, Vite 8, React Router 7 (data router), TanStack Query 5, react-hook-form + zod, CSS Modules + CSS variables.
- PostgreSQL 18; migration SQL thuần bằng `dbmate` trong `db/migrations/`.
- Keycloak 26 (OIDC), Caddy 2, ClamAV, Docker Compose.
- Kiểm thử: Vitest, Testcontainers (PostgreSQL thật), Playwright, axe-core, k6, Schemathesis.

## 3 Lệnh

```
pnpm i                  # cài
pnpm dev                # web + api + worker + db (docker compose -f deploy/compose.dev.yml)
pnpm db:migrate         # dbmate up
pnpm db:types           # kysely-codegen -> packages/db/src/schema.ts
pnpm test               # unit + integration
pnpm test:e2e           # Playwright
pnpm lint && pnpm typecheck
pnpm verify             # lint + typecheck + test + openapi:check + build (cổng PR)
```

## 4 Bất biến (vi phạm = lỗi chặn merge)

- **INV-01 Không tin client về danh tính và quyền.** Người thực hiện lấy từ phiên phía server. Không nhận `learnerId`, `role`, `schoolId`, `score`, `correct`, `decision` từ body làm căn cứ quyền hay kết quả.
- **INV-02 Mọi truy vấn dữ liệu nghiệp vụ có phạm vi trường.** Luôn lọc `school_id` và quan hệ (phân công, ghi danh, liên kết PH). Mặc định từ chối.
- **INV-03 Kiểm quyền ở use case, không ở controller hay UI.** Mỗi use case gọi `authorize(actor, action, resource)` trước khi đọc dữ liệu nhạy cảm hoặc ghi.
- **INV-04 Tiến độ ≠ ước lượng ≠ quyết định mức đạt.** Ba bảng, ba API, ba nhãn UI. Không code nào ngoài use case `publishReview` và `supersedeDecision` được ghi `attainment_decisions`.
- **INV-05 Nội dung đã phát hành bất biến.** `module_versions`, `question_items`, `rubric_versions` sau publish không UPDATE. Sửa = tạo version mới.
- **INV-06 Đáp án không rời server trước chính sách.** `question_keys` chỉ đọc trong use case chấm và trong API dành cho GV. DTO học sinh có test chứng minh không chứa khóa.
- **INV-07 Lệnh ghi có hậu quả phải idempotent.** Header `Idempotency-Key` bắt buộc cho submit, publish, release, publishReview. Cùng key + cùng body trả cùng kết quả; cùng key khác body trả 409.
- **INV-08 Giao dịch nguyên tử.** Dữ liệu nghiệp vụ, audit và outbox ghi trong cùng một transaction. Thông báo gửi sau commit qua worker.
- **INV-09 Chống ghi đè.** Bản nháp và review dùng `revision` (If-Match). Sai revision trả 409 `REVISION_CONFLICT`.
- **INV-10 Thời gian.** Lưu `timestamptz` UTC; hiển thị `Asia/Ho_Chi_Minh`. Thời điểm nộp lấy từ server.
- **INV-11 AI không có quyền quyết định.** Code AI chỉ ghi bảng `ai_proposals` và `needs_*`, `path_*`. Không import repository của review, decision, release.
- **INV-12 Thiếu dữ liệu không phải 0.** Không đổi "chưa có bằng chứng" thành 0% hay "sai". Số nhập sai định dạng trả 422, không chấm 0.
- **INV-13 Không log dữ liệu nhạy cảm.** Không log token, cookie, mật khẩu, toàn văn bài làm, nhận xét GV. Log có `request_id`.
- **INV-14 Dữ liệu người chưa thành niên.** Không gửi dữ liệu HS ra dịch vụ bên ngoài. Không thêm analytics bên thứ ba vào web.

## 5 Cấu trúc mã

```
apps/api/src/
  server.ts            # tạo Fastify, đăng ký plugin
  plugins/             # session, csrf, request-id, error-handler, auth
  routes/<module>.ts   # chỉ parse input (zod), gọi use case, map output
packages/domain/src/<module>/
  <useCase>.ts         # một use case một tệp: authorize → validate → transaction → events
  policies.ts          # hàm authorize thuần
  errors.ts
packages/db/src/       # Kysely instance, schema.ts sinh tự động, repositories
packages/contracts/src # zod schema dùng chung web/api; nguồn sinh OpenAPI
apps/web/src/
  routes/              # theo docs/07
  features/<module>/   # component + hooks gọi API
  ui/                  # primitive
```

Quy tắc phụ thuộc: `routes` → `domain` → `db`. `domain` không import Fastify hay React. `web` chỉ import `contracts`.

## 6 Khi viết một tính năng

1. Đọc mục tương ứng trong `docs/05` hoặc `docs/06` và ca kiểm thử liên quan trong `docs/09`.
2. Nếu cần đổi schema: tạo migration mới `db/migrations/YYYYMMDDHHMMSS_<ten>.sql` (không sửa migration đã merge), chạy `pnpm db:migrate && pnpm db:types`.
3. Viết zod schema trong `packages/contracts`, cập nhật `openapi/openapi.yaml` (hoặc để sinh tự động nếu đã bật).
4. Viết use case + test integration với PostgreSQL thật (Testcontainers) **trước hoặc cùng lúc** với route.
5. Viết test quyền: ít nhất một ca được phép và một ca bị từ chối cho mỗi vai trò liên quan.
6. Chạy `pnpm verify`.

## 7 Điều cấm

- Không sửa `db/migrations/*` đã merge.
- "Không sửa db/tests/*" nghĩa là không sửa tệp đã có. Được thêm tệp mới do đặc tả cung cấp, chép nguyên văn.
- Không dùng `any`, `@ts-ignore` (dùng `@ts-expect-error` kèm lý do nếu bắt buộc).
- Không SQL nối chuỗi với dữ liệu người dùng. Dùng Kysely hoặc tham số.
- Không `SELECT *` trong repository trả ra ngoài.
- Không lưu trạng thái nghiệp vụ trong `localStorage`. Chỉ lưu tùy chọn giao diện.
- Không `dangerouslySetInnerHTML` với nội dung người dùng; nội dung rich text đi qua sanitizer allowlist phía server.
- Không chạy mã học sinh nộp trên server.
- Không thêm dịch vụ mới (Redis, Kafka, Elasticsearch, microservice) khi chưa có ADR.
- Không tắt test để CI xanh. Test flaky ghi vào `tests/QUARANTINE.md` kèm issue, tối đa 7 ngày.
- Không tự bịa mã YCCĐ, KC hay nội dung chương trình. Dùng seed và dữ liệu đã duyệt.

## 8 Lỗi trả về

Định dạng thống nhất (xem docs/04): `{ "error": { "code": "REVISION_CONFLICT", "message": "…", "request_id": "…", "details": {…} } }`. Mã lỗi là hằng trong `packages/domain/src/errors.ts`. Không trả stack trace.

## 9 Commit và PR

- Commit theo Conventional Commits: `feat(submission): …`, `fix(authz): …`.
- PR ghi: mốc (M1…), use case, migration (nếu có), ca kiểm thử đã thêm, ảnh chụp UI (nếu có).
- Một PR một mục đích; migration phá cấu trúc cần mô tả rollback.

## 10 Khi không chắc

Dừng và hỏi nếu: đặc tả mâu thuẫn; cần đổi bất biến; cần thư viện mới ngoài danh sách; cần dữ liệu chương trình chưa có. Không đoán nghiệp vụ giáo dục.
