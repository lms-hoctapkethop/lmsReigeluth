# REL-01…04

Các ca này chạy trên runner với stack compose, không chạy trên VPS (docs/08 mục 0.12).

- REL-01: `docker compose stop worker`, chờ 10 phút giữa nộp và công bố, rồi `start`. Không mất bài, thông báo không trùng.
- REL-02: `HCN_ENV=test HCN_FAULT_AFTER_COMMIT=submitAssignment`. API thoát sau commit. Client gửi lại cùng Idempotency-Key.
- REL-03: dừng clamav. Upload vẫn nhận; nộp trả 423 cho đến khi clamd chạy lại.
- REL-04: dừng keycloak. Phiên cũ vẫn gọi API. Trang đăng nhập báo lỗi.

`HCN_FAULT_AFTER_COMMIT` bị từ chối khi `HCN_ENV` là `staging` hoặc `production` (`apps/api/test/config.test.ts`).
