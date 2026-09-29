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

## Kết quả `npm test` đã chạy

Lệnh: `node --experimental-strip-types --import ./tests/register.mjs --test tests/p1a.test.ts` (qua `npm test`). Node v22.14.0. File dữ liệu là thư mục tạm, không phải `data/db.json`.

Stdout của lần chạy sau khi sửa kiểu trong file kiểm thử (cùng các assertion với lần chạy trước đó):

```json
{"draft-409-save":"PASS","draft-409-submit":"PASS","idempotency-retry":"PASS","idempotency-mismatch":"PASS","P1a-08":"PASS","SINGLE_WRITER":"PASS","P1a-01":"PASS","P1a-02":"PASS","P1a-03":"PASS","P1a-04":"PASS","P1a-05":"PASS","P1a-06":"PASS","P1a-07":"PASS","P1a-09":"PASS","P1a-10":"PASS","CLASS_DELIVERY_HTTP":"PASS"}
```

`CLASS_DELIVERY_HTTP` gọi thẳng hàm mà route dùng. Chưa mở socket HTTP.

Sau kiểm thử, `data/db.json` của máy này vẫn không có trường `revision`, không có `classDeliveryEnabled`, `weekLabel` vẫn `28/09 – 04/10/2026`, chưa có module soạn.

## Còn NOT_RUN

- Nhập và phát hành kho 34 bài: NOT_RUN.
- Bật giao lớp trên `data/db.json` của trường: NOT_RUN, và không được bật ở bước này.
- Vòng HTTP thật (đăng nhập, `POST /api/modules`) và thao tác trên trình duyệt: NOT_RUN cho đến khi có biên bản riêng ở cuối file này.
- Các ca hợp đồng ghi ngoài bảng P1a-01 đến P1a-10: NOT_RUN.
- Thẩm định chuyên gia 71 KC và xuất Canvas: NOT_RUN.
