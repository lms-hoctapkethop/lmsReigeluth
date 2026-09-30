# 04 · Quy ước API

Hợp đồng chi tiết: `openapi/openapi.yaml` (55 đường dẫn, 59 thao tác, đã qua bộ kiểm OpenAPI 3.1). Tài liệu này nêu quy ước chung.

## 1 Đường dẫn và định dạng

- REST JSON dưới `/api/v1`. Xác thực ở `/auth/*`. Sức khỏe ở `/health/*`.
- Tên trường JSON dạng `camelCase`; cột DB `snake_case`. Ánh xạ trong repository.
- Thời gian ISO 8601 UTC có `Z`. Client hiển thị theo `Asia/Ho_Chi_Minh`.
- ID là UUID. Không để lộ ID tuần tự (`bigserial`) ra ngoài trừ `responseId` nội bộ GV.
- Danh sách dài dùng cursor (`?cursor=&limit=`), `limit` mặc định 50, tối đa 100. Cursor là base64 của `(sort_key, id)`.

## 2 Header

| Header | Khi nào | Ghi chú |
|---|---|---|
| `Cookie: hcn_sid` | Mọi request `/api/v1` | HttpOnly |
| `X-CSRF-Token` | POST/PUT/PATCH/DELETE | Lấy từ `GET /api/v1/me` |
| `Origin` | POST/PUT/PATCH/DELETE | Phải bằng `APP_ORIGIN` |
| `Idempotency-Key` | publishModuleVersion, releaseModules, submitAssignment, startAttempt, answerQuestion, submitAttempt, publishReview, supersedeDecision, commitFamilySupport, importUsers | UUID v4 client sinh khi người dùng bấm; giữ nguyên khi thử lại |
| `If-Match` | saveModuleDraft, saveSubmissionDraft, saveReviewDraft, changeSchedule | `W/"<revision>"` lấy từ ETag hoặc trường `revision` |
| `X-Request-Id` | Phản hồi | Caddy sinh nếu thiếu; có trong mọi lỗi |

## 3 Phân biệt DTO theo vai trò

Một tài nguyên có thể có nhiều DTO. Không dùng một DTO rồi "ẩn trường ở UI".

| Tài nguyên | DTO HS | DTO GV | DTO PH |
|---|---|---|---|
| Câu hỏi | `LearnerQuestion` (không khóa, không lỗi hiểu sai) | Bản nháp đầy đủ có `answerKey` | Không có |
| Review | Chỉ đã công bố | Nháp và đã công bố | Chỉ đã công bố, chỉ của con |
| Nhu cầu | Nhãn chữ, không `value` | Có `value`, `nObservations` | Không có (B08) |
| Bài nộp | Của mình | Trong offering được phân công | Không xem nội dung bài; chỉ tiêu đề và phản hồi |

Test bắt buộc: snapshot hình dạng DTO HS; test tìm chuỗi đáp án trong JSON phản hồi (C09, A04).

## 4 Mã trạng thái

- `200` đọc/cập nhật; `201` tạo; `204` không nội dung.
- Không có quyền với dữ liệu thuộc HS/PH → `404`. Thiếu quyền quản trị trong trường của mình → `403`.
- Lỗi theo `ErrorResponse`, danh sách mã ở docs/02 mục 8.

## 5 Giới hạn tốc độ

| Nhóm | Giới hạn |
|---|---|
| `/auth/*` | 20 request/phút/IP |
| Ghi thông thường | 120 request/phút/người dùng |
| `answerQuestion`, `requestHint` | 60 request/phút/người dùng |
| `uploadFile` | 20 tệp/10 phút/người dùng |
| `importUsers` | 5 request/giờ/trường |

Dùng `@fastify/rate-limit` với store PostgreSQL hoặc bộ nhớ tiến trình (một instance API ở pilot). Vượt giới hạn → 429 `RATE_LIMITED` kèm `Retry-After`.

## 6 Tương thích và phiên bản

- Thêm trường tùy chọn: không đổi version.
- Đổi nghĩa, xóa trường, đổi enum: tạo `/api/v2` cho tài nguyên đó hoặc thêm endpoint mới; giữ cũ tới khi web đã chuyển.
- CI chạy `oasdiff breaking openapi/openapi.yaml(main) openapi/openapi.yaml(PR)`; thay đổi phá vỡ cần nhãn PR `breaking-api` và người duyệt.

## 7 Ví dụ

### Nộp bài

```http
POST /api/v1/module-releases/88…01/items/84…01/submissions
Cookie: hcn_sid=…
X-CSRF-Token: 6f1c…
Origin: https://hoc.truong.edu.vn
Idempotency-Key: 0d7a8f5e-2b0e-4c1b-9a37-2f7a8b1c9d10
Content-Type: application/json

{"draftRevision": 4}
```

```http
HTTP/1.1 201 Created
X-Request-Id: req_01J9…

{"submissionId":"89…01","submissionVersionId":"8a…02","versionNo":2,
 "submittedAt":"2026-10-08T14:03:11.412Z","isLate":false,
 "contentHash":"3b1f…"}
```

Gửi lại cùng key và cùng body → cùng phản hồi 201. Cùng key, `draftRevision` khác → 409 `IDEMPOTENCY_KEY_REUSED`.

### Công bố review

```json
POST /api/v1/reviews/8b…01/publish
{"expectedRevision":3,
 "expectedSubmissionVersionId":"8a…02",
 "outcome":"reviewed",
 "decisions":[{"requirementId":"60…01","decision":"achieved","reason":"Đạt đủ ba tiêu chí, có ca thử ngưỡng"}]}
```

Nếu HS đã nộp v3 sau khi GV mở v2 → 409 `SUBMISSION_VERSION_CHANGED` với `details.currentSubmissionVersionId`.
