# Sổ tay staging

Staging chạy chung VPS với site trường. Cursor không SSH, không giữ khóa. Phần ops nằm ở cuối tệp này.

## Cài

Ops chạy `deploy/staging/install.sh` bằng root từ một bản checkout. Script tạo `hcndeploy`, sudoers, secret còn thiếu và ba timer: diff các ngày trừ thứ bảy lúc 18:00 UTC, full thứ bảy 18:00 UTC, tệp 18:30 UTC. Đổi `bin/` thì chạy lại `install.sh`.

## Deploy

Workflow `deploy-staging` gửi bundle qua `hcn-staging receive` rồi `deploy`. Khói lỗi thì `rollback`. Schema không lùi.

## Hoàn tác

`sudo /opt/hcn-staging/bin/hcn-staging` với lệnh `rollback` đưa image về bản `previous`.

## Sự cố riêng

- Cổng 18080 hoặc 19090 đã dùng: preflight thoát 10.
- Thiếu RAM hoặc đĩa: thoát 11, không hạ giới hạn.
- Cổng 443 do container của site trường giữ: thoát 12, dừng và hỏi người điều phối.
- Perf ngoài 22:00–05:00 giờ Việt Nam: thoát 75.

## Việc ops phải làm trước khi workflow deploy chạy được

1. DNS Cloudflare: A `staging-lms` và A `id-staging-lms` trỏ IP VPS, Proxied. SSL Full (strict), Always Use HTTPS, cache bypass `/api/*`, `/auth/*`, `/health/*`, tắt Rocket Loader, Email Obfuscation, Zaraz.
2. Sinh khóa và CSR trên VPS. Cloudflare "Use my private key and CSR" cho hai tên staging. Chép chứng chỉ vào `/etc/ssl/hcn-staging/origin.pem`. Khóa không rời máy.
3. Chạy `deploy/staging/preflight.sh` và dán kết quả (không có bí mật). Nếu thoát 12, hỏi người điều phối trước khi đụng proxy.
4. Áp một tệp mới từ `deploy/staging/host-proxy/`, kiểm cú pháp, reload. Không sửa khối `lms.hoctapkethop.edu.vn`.
5. Bucket S3 trong nước `hcn-staging-backup`, key riêng. Điền `secrets/pgbackrest.env` và `secrets/restic.env`. Ký gửi mật khẩu vào kho mật khẩu trường.
6. `ssh-keygen -t ed25519` cho GitHub Actions. Public key vào `authorized_keys` của `hcndeploy` với `restrict,command="sudo /opt/hcn-staging/bin/hcn-staging"`. Private key vào secret rồi xóa bản trên máy.
7. GitHub Environment `staging` (chỉ `main` và tag `v*`): secret `STAGING_SSH_HOST`, `STAGING_SSH_PORT`, `STAGING_SSH_USER`=`hcndeploy`, `STAGING_SSH_KEY`, `STAGING_SSH_KNOWN_HOSTS`. Biến `STAGING_APP_DOMAIN`, `STAGING_ID_DOMAIN`. Mật khẩu khói điền sau lần seed đầu.
8. Nếu ufw chỉ mở SSH cho IP văn phòng, chọn: mở 22/tcp kèm khóa và fail2ban, hoặc runner nội bộ (để M10).
9. Sau deploy đầu: `stanza-create` và `pgbackrest check`. Seed chương trình, rồi `hcn-staging seed`.

Khi các bước trên xong, báo lại để chạy deploy, khói, perf trong khung giờ và diễn tập khôi phục.
