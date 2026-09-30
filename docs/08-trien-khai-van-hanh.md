# 08 · Triển khai và vận hành

Mục tiêu: một máy Ubuntu 24.04 LTS, 8 vCPU, 16 GB RAM, SSD 200 GB (cấu hình thử, cần đo ở M9). Hai môi trường tách: **staging** (máy nhỏ hơn hoặc cùng máy khác thư mục/domain) và **production**. Tệp cấu hình ở `deploy/`.

## 1 Thành phần

| Dịch vụ | Image | Cổng | Mạng |
|---|---|---|---|
| caddy | build `deploy/caddy/Dockerfile` (web tĩnh + Caddy 2) | 80, 443 công khai | edge |
| api | `hcn/api:<version>` | 3000 nội bộ | edge, internal |
| worker | cùng image, lệnh khác | — | internal |
| db | `hcn/postgres:18` (postgres:18 + pgBackRest) | 5432 nội bộ | internal |
| keycloak | `quay.io/keycloak/keycloak:26.7` | 8080 nội bộ, 9000 health | edge, internal |
| clamav | `clamav/clamav:1.4` | 3310 nội bộ | internal |
| node-exporter | Prometheus node exporter | nội bộ | internal |
| migrate | dbmate 2 (profile `ops`) | — | internal |

`deploy/compose.yml` đã kiểm bằng `docker compose config`. Cursor cần viết thêm: `deploy/api/Dockerfile` (multi-stage, `node:26-bookworm-slim`, chạy user không root, `pnpm deploy --prod`), `deploy/caddy/Dockerfile` (stage build `apps/web`, stage chạy `caddy:2`, copy `dist` vào `/srv/web`).

## 2 Chuẩn bị máy (một lần)

```bash
# 1. Người dùng quản trị, SSH chỉ khóa
adduser ops && usermod -aG sudo ops
# /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no; systemctl restart ssh

# 2. Tường lửa
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80,443/tcp && ufw allow 443/udp && ufw enable
# Nên giới hạn 22/tcp theo IP văn phòng hoặc qua VPN

# 3. Cập nhật bảo mật tự động
apt install -y unattended-upgrades fail2ban && dpkg-reconfigure -plow unattended-upgrades

# 4. Docker Engine + Compose plugin theo hướng dẫn chính thức docs.docker.com (repo apt của Docker)
# 5. Giờ hệ thống UTC; ứng dụng tự hiển thị Asia/Ho_Chi_Minh
timedatectl set-timezone UTC
```

Lưu ý: Docker ghi quy tắc iptables riêng và có thể vượt qua ufw cho cổng được publish. Chỉ publish 80/443 của Caddy; không publish cổng DB, Keycloak, API.

## 3 DNS và bí mật

- Bản ghi A/AAAA cho `APP_DOMAIN` và `ID_DOMAIN` trỏ về máy.
- `cp deploy/.env.example deploy/.env` và điền.
- Tạo `deploy/secrets/*.txt` (chmod 600, chủ `root`), mỗi mật khẩu ngẫu nhiên ≥ 32 ký tự: `openssl rand -base64 36 | tr -d '\n' > deploy/secrets/pg_api_password.txt`.
- `database_url_api.txt` = `postgres://hcn_api:<pg_api_password>@db:5432/hcn`; tương tự `database_url_worker.txt` (`hcn_worker_login`), `database_url_owner.txt` (`hcn_owner`).
- Ứng dụng đọc biến `*_FILE` (docs/02 mục 10); Keycloak đọc qua `deploy/keycloak/kc-entrypoint.sh`.

## 4 Triển khai lần đầu

```bash
cd /opt/hcn && git clone <repo> . && git checkout v3.0.0
docker compose -f deploy/compose.yml --env-file deploy/.env build
docker compose -f deploy/compose.yml --env-file deploy/.env up -d db
docker compose -f deploy/compose.yml --env-file deploy/.env --profile ops run --rm migrate up
docker compose -f deploy/compose.yml --env-file deploy/.env exec -T db \
  psql -U postgres -d hcn -v ON_ERROR_STOP=1 -f /dev/stdin < db/tests/schema_invariants.sql   # phải in 26 PASS và ROLLBACK
docker compose -f deploy/compose.yml --env-file deploy/.env run --rm api node apps/api/dist/cli.js seed-curriculum db/seeds/curriculum_requirements.json
docker compose -f deploy/compose.yml --env-file deploy/.env up -d
```

Sau khi Keycloak chạy:

1. Mở console quản trị qua đường hầm SSH (`ssh -L 8080:localhost:8080` rồi `docker compose exec` với port nội bộ); console không mở ra Internet (Caddy chặn `/admin`).
2. Realm `hcn` → Clients → `hcn-web` và `hcn-provisioner` → Regenerate secret → ghi vào `oidc_client_secret.txt`, `kc_provisioner_secret.txt` → `docker compose up -d api`.
3. Sửa `redirectUris`, `webOrigins`, `post.logout.redirect.uris` đúng tên miền thật.
4. Tạo tài khoản quản trị trường đầu tiên bằng CLI: `node apps/api/dist/cli.js bootstrap-school --code THPT-A --name "…" --admin-username admin.a`.
5. Chạy kiểm tra khói (mục 8).

## 5 Sao lưu

| Đối tượng | Công cụ | Lịch | Giữ |
|---|---|---|---|
| PostgreSQL (hcn, keycloak) | pgBackRest: WAL liên tục (`archive_timeout=300`), full chủ nhật 01:00, diff các ngày khác 01:00 | Cron trên host gọi `docker compose exec db pgbackrest --stanza=hcn --type=full backup` | repo1 (cùng máy): 4 full; repo2 (S3 ngoài máy, mã hóa): 8 full |
| Tệp bài nộp (`files` volume) | restic tới S3 ngoài máy | 01:30 hằng ngày | 14 ngày, 8 tuần, 12 tháng |
| Cấu hình | git (không bí mật) + bản sao bí mật mã hóa trong kho mật khẩu của trường | Khi đổi | — |

Khởi tạo: `docker compose exec db pgbackrest --stanza=hcn stanza-create` rồi `pgbackrest --stanza=hcn check`.

Sau mỗi lần sao lưu thành công, script ghi thời điểm vào `/var/lib/node_exporter/textfile/backup.prom` (`hcn_last_backup_timestamp_seconds{kind="pg_full|pg_diff|files"}`) để giám sát.

Thứ tự khi khôi phục: DB về mốc T, rồi tệp về mốc ≥ T. Tệp bài nộp bất biến nên thừa tệp không gây sai; thiếu tệp thì bài nộp mở ra lỗi → khôi phục tệp phải bao được mốc DB.

## 6 Diễn tập khôi phục (bắt buộc trước pilot, lặp lại mỗi học kỳ)

1. Dựng máy trống cùng cấu hình (hoặc VM).
2. Cài theo mục 2–3 với bí mật thật từ kho mật khẩu.
3. `pgbackrest --stanza=hcn --repo=2 --type=time --target="<T>" restore` vào volume mới; khởi động db.
4. `restic restore latest --target /var/lib/docker/volumes/hcn_files/_data`.
5. Khởi động toàn bộ; chạy kiểm tra khói và kịch bản AC13: đăng nhập 3 vai trò, mở một bài nộp có tệp, so `content_hash` và `sha256` tệp.
6. Ghi thời gian thực hiện (RTO) và khoảng dữ liệu mất (RPO) vào `docs/ops/restore-drill-<ngày>.md`. Mục tiêu: RPO ≤ 1 giờ, RTO ≤ 4 giờ (NFR-05).

## 7 Giám sát và cảnh báo

Tối thiểu cho pilot:

| Tín hiệu | Nguồn | Ngưỡng cảnh báo |
|---|---|---|
| `https://APP_DOMAIN/health/ready` | Dịch vụ giám sát ngoài (Uptime Kuma trên máy khác hoặc dịch vụ SaaS không nhận dữ liệu HS) | 2 lần thất bại liên tiếp |
| Tỉ lệ 5xx | `/metrics` API | > 1% trong 5 phút |
| p95 độ trễ | `/metrics` API | > 1,5 giây trong 10 phút |
| `outbox_pending` | `/metrics` | > 500 trong 10 phút |
| `outbox_dead` | `/metrics` | > 0 |
| `files_pending_scan` | `/metrics` | > 50 trong 15 phút |
| Tuổi bản sao lưu | node-exporter textfile | full > 8 ngày, diff > 26 giờ, files > 26 giờ |
| Dung lượng đĩa | node-exporter | > 80% |
| Hết hạn chứng chỉ | Caddy tự gia hạn; kiểm ngoài | < 14 ngày |

Có thể chạy Prometheus + Alertmanager trong mạng `internal` (thêm vào compose ở M9) gửi cảnh báo qua email hoặc Telegram của tổ IT. Không gửi dữ liệu HS trong nội dung cảnh báo.

## 8 Kiểm tra khói sau triển khai

```bash
BASE=https://$APP_DOMAIN
curl -fsS $BASE/health/ready
curl -fsSI $BASE/ | grep -i "content-security-policy"
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/v1/me          # 401
curl -s -o /dev/null -w "%{http_code}\n" https://$ID_DOMAIN/admin/  # 404
pnpm --filter e2e exec playwright test --grep @smoke --config e2e/playwright.smoke.config.ts   # chạy từ máy CI tới staging/production với tài khoản kiểm thử riêng
```

Bộ `@smoke`: đăng nhập HS kiểm thử → mở "Hôm nay" → mở một bài → lưu nháp → không nộp; đăng nhập GV kiểm thử → mở hàng chờ. Tài khoản kiểm thử thuộc một offering "KIỂM THỬ" ẩn với HS thật.

## 9 Phát hành phiên bản

1. CI xanh trên `main` (docs/09 mục 8), tag `vX.Y.Z`, build image gắn tag và commit, quét Trivy.
2. Triển khai staging với dữ liệu ẩn danh hoặc tổng hợp; chạy E2E đầy đủ và kiểm tra khói.
3. Production, ngoài giờ học (sau 21:00 hoặc cuối tuần):
   - `pgbackrest --type=diff backup` (sao lưu ngay trước khi đổi).
   - `migrate up` (migration phải **tương thích ngược**: bản API cũ vẫn chạy được với schema mới; cột mới nullable hoặc có default; xóa cột ở phiên bản sau).
   - `docker compose up -d api worker caddy` với `APP_VERSION` mới.
   - Kiểm tra khói.
4. Hoàn tác: đổi `APP_VERSION` về bản trước và `up -d`. Migration phá cấu trúc (hiếm) cần kế hoạch riêng có bước khôi phục DB, được duyệt trước.
5. Ghi `CHANGELOG.md`: tính năng, migration, rủi ro, kết quả kiểm tra.

## 10 Sổ tay sự cố

| Tình huống | Dấu hiệu | Xử lý |
|---|---|---|
| Worker dừng | `outbox_pending` tăng; HS không nhận thông báo | `docker compose logs worker`; `up -d worker`. Bài nộp và review không mất (đã commit); thông báo được gửi bù khi worker chạy lại, không trùng (A08) |
| Sự kiện `dead` | `outbox_dead > 0` | Xem `last_error`; sửa nguyên nhân; `UPDATE outbox_events SET status='pending', attempts=0, available_at=now() WHERE id=…` bằng tài khoản `hcn_owner`, ghi vào sổ vận hành |
| ClamAV không sẵn sàng | `files_pending_scan` tăng; HS nhận 423 khi nộp | Kiểm bộ nhớ (clamd cần ~1,5 GB); khởi động lại; tệp đợi được quét khi clamd chạy |
| Keycloak lỗi | Không đăng nhập được; phiên hiện có vẫn dùng được tới khi hết hạn | Kiểm DB keycloak, log; khởi động lại |
| Đĩa gần đầy | > 80% | Kiểm `pgbackrest` repo1, log Docker (`/etc/docker/daemon.json`: `log-opts max-size=50m, max-file=5`), volume files |
| Nghi lộ tài khoản | Đăng nhập bất thường | Khóa tài khoản trong Keycloak và đặt `users.status='locked'` (API từ chối ngay); thu hồi phiên: `UPDATE sessions SET revoked_at=now() WHERE user_id=…`; ghi audit; báo nhà trường theo quy trình bảo vệ dữ liệu cá nhân |
| Cần khôi phục dữ liệu bị xóa nhầm | Báo từ GV | Không sửa tay production. Khôi phục PITR vào máy tạm, trích dữ liệu cần thiết, nhập lại bằng use case có audit |

## 11 Dữ liệu cá nhân

- Nhà trường là bên kiểm soát dữ liệu; đơn vị vận hành là bên xử lý theo thỏa thuận.
- Trước khi nhập dữ liệu thật: thông báo và xin đồng ý theo Luật Bảo vệ dữ liệu cá nhân 2025 (Luật 91/2025/QH15, hiệu lực 01/01/2026) và văn bản hướng dẫn, đặc biệt với dữ liệu trẻ em; nội dung cụ thể do pháp chế nhà trường xác nhận.
- Khuyến nghị đặt máy chủ và kho sao lưu ngoài máy tại Việt Nam, sao lưu có mã hóa; yêu cầu cụ thể về lưu trữ và chuyển dữ liệu ra nước ngoài do pháp chế xác nhận.
- Không dùng dịch vụ giám sát, phân tích, font, CDN bên ngoài nhận dữ liệu HS (INV-14).
