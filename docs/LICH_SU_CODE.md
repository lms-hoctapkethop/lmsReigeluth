# Lịch sử thay đổi — adapter JSON và P1a

Mốc: 29/09/2026. Nhánh `main`. App vẫn là Next.js, phiên cookie, file JSON. Không chuyển Postgres, Fastify hay Keycloak.

## Việc đã code

- `revision` cho toàn bộ file JSON. Thiếu `expectedRevision` trên lệnh ghi nghiệp vụ trả HTTP 400.
- Mọi đường ghi nghiệp vụ đi qua `commitWrite`: khóa, đọc, kiểm mã gửi lại, kiểm revision, áp dụng, rồi mới tăng revision và ghi biên nhận trong cùng một lần ghi (file tạm + đổi tên). Đọc không ghi lại file.
- Hai lệnh khác key, cùng revision: một lệnh commit, lệnh kia HTTP 409 mã `REVISION_CONFLICT`.
- Gửi lại cùng key và cùng nội dung trả biên nhận cũ, không gọi lại phần ghi. Cùng key, khác nội dung: HTTP 422 mã `IDEMPOTENCY_MISMATCH`. Kiểm mã gửi lại đứng trước kiểm revision.
- Lệch `draft.version` vẫn HTTP 409 ở cả lưu nháp và nộp bài thực hành, không dùng mã `REVISION_CONFLICT`.
- Một writer: hàng đợi trong tiến trình cộng file khóa PID. Tiến trình khác còn sống nhận HTTP 503 mã `SINGLE_WRITER`.
- Module P1a nằm cạnh bài `if–else` hiện có: năm loại mục, ảnh chụp bất biến, quiz hoàn thành bằng lần nộp và không ghi KC, `min_score` và cổng KC trả `FEATURE_NOT_ENABLED`.
- `classDeliveryEnabled` chỉ đúng khi file ghi đúng `true`. API `action: "deliver"` gọi `rejectDisabledDelivery` và từ chối `CLASS_DELIVERY_OFF` trước khi vào vùng ghi. Ca kiểm thử bật cờ chỉ trên file tạm.
- Tuần lớp trong seed và trong `data/db.json` giữ `28/09 – 04/10/2026`. Kho 34 bài không được nhập.
- Các lời gọi file của adapter có chú thích `turbopackIgnore` để bản build không kéo cả cây mã vào gói server.

## Kết quả `npm test` đã chạy

Lệnh: `node --experimental-strip-types --import ./tests/register.mjs --test tests/p1a.test.ts` (qua `npm test`). Node v22.14.0. File dữ liệu là thư mục tạm, không phải `data/db.json`.

Stdout của lần chạy sau khi sửa kiểu trong file kiểm thử (cùng các assertion với lần chạy trước đó):

```json
{"draft-409-save":"PASS","draft-409-submit":"PASS","idempotency-retry":"PASS","idempotency-mismatch":"PASS","P1a-08":"PASS","SINGLE_WRITER":"PASS","P1a-01":"PASS","P1a-02":"PASS","P1a-03":"PASS","P1a-04":"PASS","P1a-05":"PASS","P1a-06":"PASS","P1a-07":"PASS","P1a-09":"PASS","P1a-10":"PASS","CLASS_DELIVERY_HTTP":"PASS"}
```

`CLASS_DELIVERY_HTTP` gọi thẳng hàm mà route dùng. Chưa mở socket HTTP.

Sau kiểm thử, `data/db.json` của máy này vẫn không có trường `revision`, không có `classDeliveryEnabled`, `weekLabel` vẫn `28/09 – 04/10/2026`, chưa có module soạn.

## Kết quả HTTP trên server tạm

`next start` cổng 43141, `HCN_DB_PATH=/tmp/hcn-ui/db.json` (bản sao). Không đụng `data/db.json`.

- Giáo viên tạo mẫu: 5 dòng, 3 requirement, revision 1, tuần `28/09 – 04/10/2026`, `classDeliveryEnabled` false.
- Lưu tiêu đề tăng revision. `action: "deliver"` trả HTTP 403 mã `CLASS_DELIVERY_OFF`. Thiếu `expectedRevision` trả HTTP 400.
- Học sinh không thấy bản soạn. `GET /api/learn` vẫn là bài `Bài 03 · Rẽ nhánh if–else`, tuần không đổi, revision có trong payload.
- Lưu nháp với `version: 9` trả HTTP 409, câu “Bản nháp trên máy chủ đã mới hơn. Hãy tải lại trước khi lưu.”, không có mã `REVISION_CONFLICT`.

Trên trình duyệt, cùng server: giáo viên mở Module soạn thảo, thấy giao lớp tắt và mẫu số 3, lưu tiêu đề “Tuần mẫu trên lớp”, tải lại vẫn còn tiêu đề đó. Tổng quan vẫn hiện tuần `28/09 – 04/10/2026` và bài 03. Không có nút giao lớp.

Sau các thao tác đó, `data/db.json` vẫn không có `revision`, không có `classDeliveryEnabled`, tuần vẫn `28/09 – 04/10/2026`. File tạm có bản soạn, `pathRelease` null, giao lớp false.

## Còn NOT_RUN

- Nhập và phát hành kho 34 bài: NOT_RUN.
- Bật giao lớp trên `data/db.json` của trường: NOT_RUN, và không được bật ở bước này.
- Triển khai lên máy chủ trường: NOT_RUN.
- Các ca hợp đồng ghi ngoài bảng P1a-01 đến P1a-10: NOT_RUN.
- Thẩm định chuyên gia 71 KC và xuất Canvas: NOT_RUN.
