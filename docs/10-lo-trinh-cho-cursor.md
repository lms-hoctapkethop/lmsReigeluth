# 10 · Lộ trình cho Cursor

Làm tuần tự M0 → M10. Mỗi mốc là một nhánh `m<n>-<ten>` và một hoặc nhiều PR. Không bắt đầu mốc sau khi mốc trước chưa đạt điều kiện hoàn thành. Mã ca tra trong `tests/acceptance/traceability.csv`.

Cách dùng prompt: mở Cursor ở chế độ Agent, dán nguyên khối prompt của mốc. Nếu Cursor hỏi hoặc đề xuất lệch đặc tả, trả lời bằng cách trỏ về mục tài liệu. Sau mỗi mốc, tự kiểm lại bằng câu hỏi ở cuối mốc.

Ước lượng thời gian bên dưới là cho một dev làm cùng Cursor, chỉ để lập kế hoạch; điều chỉnh theo thực tế.

---

## M0 · Khởi tạo nền (2–3 ngày)

**Mục tiêu**: repo chạy được, DB đúng schema, CI xanh với bất biến DB và vector tham chiếu.

```text
Đọc AGENTS.md, docs/02-kien-truc-he-thong.md mục 2–4 và 10.
Tạo monorepo pnpm theo đúng cấu trúc ở docs/02 mục 3:
- package.json gốc với scripts: dev, build, lint, typecheck, test, test:e2e, db:migrate, db:types, db:seed:curriculum, db:seed:test, openapi:check, verify.
- tsconfig.base.json strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes.
- ESLint flat config + typescript-eslint strict + quy tắc import: packages/domain không import fastify, react, apps/*; apps/web chỉ import packages/contracts.
- packages/db: Kysely + pg, kysely-codegen sinh src/schema.ts từ DB; script db:types.
- packages/domain: port NGUYÊN VẸN các hàm ở tests/reference/pure.reference.mjs sang TypeScript (normalizeNumber, gradeResponse, observationFromResponse, observationFromCriterion, r0Estimate, rootGaps, computeCoverage) theo đường dẫn ở docs/06; chép toàn bộ VECTORS thành test Vitest, tên test giữ mã (N01, G01, R01…).
- packages/testkit: helper Testcontainers postgres:18 chạy dbmate up rồi tạo template DB; mỗi file test clone một DB.
- Không viết API hay web ở mốc này ngoài apps/api/src/main.ts trả /health/live.
- .github/workflows/ci.yml đã có sẵn; làm cho các job static, database, unit-integration, build chạy xanh.
Không sửa db/migrations/*.sql, db/tests/*.sql, tests/reference/*.
```

**Hoàn thành khi**: DB01–DB16 PASS trong CI; 37 vector PASS cả ở `node tests/reference/pure.reference.mjs` và Vitest; `pnpm verify` xanh; SEC-17, SEC-19, SEC-20.

**Tự kiểm**: `grep -r "from 'fastify'" packages/domain` trả rỗng?

---

## M1 · Xác thực, phiên, CSRF, ngữ cảnh (3–4 ngày)

```text
Đọc docs/02 mục 5–9, docs/04, openapi.yaml (tag session).
Trong apps/api:
- plugins: request-id (lấy X-Request-Id hoặc sinh), pino logger với redact theo docs/02 mục 9, error-handler map DomainError → ErrorResponse, session (cookie hcn_sid, bảng sessions lưu sha256), csrf (X-CSRF-Token + Origin cho method không an toàn), rate-limit theo docs/04 mục 5.
- /auth/login, /auth/callback, /auth/logout dùng openid-client 6, Authorization Code + PKCE, cookie tạm hcn_oidc ký HMAC. Không tự tạo user; user chưa có → 403 trang "chưa được cấp quyền".
- GET /api/v1/me, POST /api/v1/me/context.
- Cấu hình đọc biến *_FILE (secret) theo docs/02 mục 10, validate bằng zod khi khởi động.
- Test integration dùng oidc-provider làm IdP giả trong test, persona từ packages/testkit.
- packages/domain/src/identity/policies.ts: khung can(actor, action, facts) và bảng ma trận ở docs/05 mục 2 (các action chưa có use case để TODO nhưng có kiểu).
Trong apps/web: khung Vite + React Router 7, trang /login-required, layout có sidebar theo docs/07, gọi /me, chọn ngữ cảnh.
```

**Hoàn thành khi**: J01; SEC-02, SEC-03, SEC-04, SEC-10, SEC-11; INV-01, INV-13 có test.

---

## M2 · Tổ chức và seed chương trình (4–5 ngày)

```text
Đọc docs/05 mục 2–3, docs/02 mục 6.1, docs/03 mục 7.
- Use case org: importUsers (Keycloak Admin REST qua service account hcn-provisioner, bù trừ khi DB lỗi), createOffering, assignTeacher, enrollLearners, createGuardianLink, verifyGuardianLink, revokeGuardianLink, transferClass.
- CLI apps/api/src/cli.ts: bootstrap-school, seed-curriculum <json> (idempotent, không ghi đè hàng approved).
- packages/testkit/personas.ts theo docs/09 mục 4; lệnh db:seed:test.
- apps/api/test/authz/matrix.test.ts sinh ca cho mọi ô ma trận docs/05 mục 2 với các action đã có.
- Web: /quan-tri (năm học, lớp, offering, phân công, ghi danh), /quan-tri/tai-khoan (upload CSV, hiện mật khẩu tạm một lần, không lưu), /quan-tri/phu-huynh.
```

**Hoàn thành khi**: J02; AC02, AC03, A01, A03; SEC-01 (phần org), SEC-05, SEC-18; seed chạy hai lần không đổi dữ liệu.

---

## M3 · Chương trình, KC, lỗi hiểu sai (3 ngày)

```text
Đọc docs/05 mục 4, docs/03 mục 2.
- Use case curriculum: reviewRequirement, proposeKc, reviewKcVersion (version mới khi sửa nội dung), proposeKcEdge, reviewKcEdge (map lỗi trigger KC_EDGE_CYCLE → 422), proposeMisconception, reviewMisconception.
- Quyền curriculum.review theo bảng curriculum_reviewers.
- Web /chuyen-mon: hàng đợi YCCĐ (ưu tiên extraction=check), KC, cạnh, lỗi hiểu sai; xem song song văn bản YCCĐ.
- Nạp dữ liệu mẫu KC/cạnh/lỗi hiểu sai cho 5 module ở tệp 09 (bổ sung 2.2) vào db:seed:test với trạng thái approved (chỉ môi trường test).
```

**Hoàn thành khi**: DB04 qua API (422 khi tạo vòng); B04; màn chuyên môn dùng được bằng bàn phím.

---

## M4 · Soạn bài và phát hành phiên bản (6–8 ngày)

```text
Đọc docs/05 mục 5, docs/03 mục 4, docs/06 mục 6, docs/07 mục 3.3.
- packages/contracts: zod ModuleDraft v1 đầy đủ (clientKey, answerKey, rich text hcn-rich/1 với danh sách khối cho phép).
- Sanitizer rich text phía server (không lưu HTML thô).
- Use case: createModule, saveModuleDraft (If-Match), validateModuleDraft (computeCoverage), publishModuleVersion (idempotency, chặn V01/V05/V07, yêu cầu acknowledgements cho caution, ghi đủ bảng bất biến trong một transaction).
- GET draft chỉ cho người có quyền author (có answerKey).
- Web Studio /day/soan/:moduleId: dàn mục (kéo thả + nút lên/xuống), editor theo loại mục, editor câu hỏi (KC, Bloom, gợi ý, lỗi hiểu sai), editor rubric, ma trận độ phủ, publish với hộp lý do.
- Xem trước dưới góc nhìn HS không ghi tiến độ.
```

**Hoàn thành khi**: J03; P1a-01, P1a-02, P1a-08; AC08, AC16; A07; C01, C02, C07, C10; SEC-06.

---

## M5 · Giao bài, học, nộp bài, tệp (6–8 ngày)

```text
Đọc docs/05 mục 6–7, docs/07 mục 3.1, docs/08 mục 1 (ClamAV).
- Use case: releaseModules (một transaction, idempotency), changeSchedule, markViewed, selfMark, saveSubmissionDraft, uploadFile (stream, sha256, file-type, allowlist, 25 MiB), submitAssignment, getSubmission, downloadFile.
- Worker: vòng lặp outbox (FOR UPDATE SKIP LOCKED, retry lũy thừa, dead sau 8 lần), consumer files.scan (clamd INSTREAM), job dọn dẹp.
- DTO học sinh LearnerRelease không có trường khóa; test snapshot.
- Web: /hoc, /hoc/lop/:id, /hoc/bai/:releaseId, trang nhiệm vụ với tự lưu, xử lý 409/423, biên nhận nộp; /day/lop/:id/giao.
```

**Hoàn thành khi**: J04, J06; P1a-03, P1a-04, P1a-07, P1a-09; AC01, AC04, AC05, AC06, AC12; A05, A13; SEC-07, SEC-09, SEC-16.

---

## M6 · Quiz (5 ngày)

```text
Đọc docs/05 mục 8, docs/06 mục 1–2.
- Use case: startAttempt, answerQuestion (zod strict, gradeResponse, misconception từ option_misconceptions, không lộ đáp án khi sai), requestHint (attempt_hint_usage), submitAttempt (completion bất kể điểm, không ghi attainment).
- Mục đích diagnostic/exit_ticket một lượt; practice không giới hạn lượt, try_no theo câu.
- FEATURE_NOT_ENABLED cho min_score và KC gate.
- Web quiz theo docs/07 mục 3.2: một câu một màn hình trên điện thoại, gợi ý theo bậc, "Em chưa học phần này", inputmode decimal, thông điệp lỗi định dạng số.
```

**Hoàn thành khi**: J05, J11; P1a-05, P1a-06, P1a-10; AC09; A04, A14; B05, B13; C04, C08, C09; SEC-08.

---

## M7 · Chấm bài, hồ sơ, phụ huynh, thông báo (6–7 ngày)

```text
Đọc docs/05 mục 9–11, docs/06 mục 7, docs/07 mục 3.4, 3.6.
- Use case: getReviewQueue (cursor), openReview, saveReviewDraft (If-Match), publishReview (khóa submissions rồi reviews, SUBMISSION_VERSION_CHANGED, decisions nối tiếp quyết định hiện hành), supersedeDecision, getLearnerRecords, listMyChildren, getChildOverview, commitFamilySupport, cancelFamilySupport, listNotifications, markNotificationRead.
- Worker consumer notify (payload chỉ tiêu đề + đường dẫn), nhắc hạn due_soon.
- Web: hàng chờ, bàn chấm (phím tắt, cảnh báo phiên bản mới), hồ sơ HS ba lớp số liệu, cổng PH, hộp thông báo.
```

**Hoàn thành khi**: J07, J08, J09, J10; AC07, AC10, AC11; A02, A06, A08; B09; C06.

---

## M8 · Nền dữ liệu AI: quan sát, R0, bản đồ nhiệt (4–5 ngày)

```text
Đọc docs/06 mục 3–5, 8 và bổ sung 2.2 tệp 08.
- Worker consumers: insight.deriveObservations (từ QuestionAnswered và ReviewPublished; chỉ KC observable; ON CONFLICT DO NOTHING), insight.recomputeNeeds (r0Estimate, model_version R0@1.0.0, chỉ INSERT khi đổi), insight.updateMisconceptionSignals.
- API: getLearnerNeeds (HS chỉ nhãn chữ, GV có value, PH 404), getHeatmap (thứ tự tô-pô, lastUpdatedAt).
- Web: /day/lop/:id bản đồ nhiệt, nhóm hổng gốc (rootGaps), bật giá trị số chỉ cho GV; hồ sơ HS có mục "Nhu cầu" nhãn chữ.
- Đảm bảo worker chạy bằng role hcn_worker (DATABASE URL riêng) và test chứng minh không ghi được attainment.
- Feature flag ai=false: không có code gọi LLM.
```

**Hoàn thành khi**: J12; B01, B02, B03, B06, B08, B10, B11; C03, C05; A16, A18.

---

## M9 · Sẵn sàng vận hành (5–7 ngày)

```text
Đọc docs/08 toàn bộ, docs/09 mục 6–10.
- deploy/api/Dockerfile (multi-stage, user không root), deploy/caddy/Dockerfile (build web + caddy).
- /metrics Prometheus nội bộ; các metric ở docs/02 mục 9 và docs/08 mục 7.
- perf/*.js k6 PERF-01…05 và script sinh dữ liệu 1 200 HS.
- e2e: đủ project trình duyệt; checkA11y trên mọi route chính.
- Schemathesis job hằng đêm; ZAP baseline; Trivy.
- Script backup (pgBackRest, restic) và ghi metric textfile; tài liệu diễn tập khôi phục.
- Dựng staging theo docs/08, chạy kiểm tra khói.
```

**Hoàn thành khi**: cổng G3 đạt trên staging: PERF-01…05; SEC-12…15, SEC-21; A11Y-01…08 (biên bản); REL-01…06; AC13, AC14, AC15; A09, A10, A15.

---

## M10 · Chuẩn bị pilot và phần mở rộng (theo nhu cầu)

- Cổng G4: kiểm thử xâm nhập độc lập, UAT (docs/09 mục 11), thẩm định nội dung (mục 12), hồ sơ bảo vệ dữ liệu cá nhân.
- Nâng Node 24 → 26 nếu M0 bắt đầu trên 24.
- Cảnh báo sớm W1–W5, giao nhiệm vụ bổ trợ theo nhóm, V06, chấm tay short_text, nhiệm vụ thay thế có duyệt (B07, B12, B14, A11, A12).
- AI cho GV (bổ sung 2.2 tệp 08, 09) chỉ sau khi có bộ đánh giá AI và A17, SEC-22.

---

## Câu hỏi tự kiểm sau mỗi mốc

1. Có use case nào ghi `attainment_decisions` ngoài `publishReview` và `supersedeDecision` không? (phải không)
2. Có DTO học sinh nào chứa `answerKey`, `rationale`, `misconception` không? (chạy test C09)
3. Mọi endpoint mới đã có hàng trong ma trận quyền chưa?
4. Mọi lệnh có hậu quả đã yêu cầu `Idempotency-Key` và có test gửi lại chưa?
5. Có chỗ nào đổi "chưa có dữ liệu" thành 0 không?
6. `traceability.csv` đã cập nhật `test_location` cho các ca của mốc chưa?
