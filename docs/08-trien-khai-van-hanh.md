# 08 · Triển khai và vận hành

Mục tiêu: một máy Ubuntu 24.04 LTS, 8 vCPU, 16 GB RAM, SSD 200 GB (cấu hình thử, cần đo ở M9). Hai môi trường tách: **staging** (máy nhỏ hơn hoặc cùng máy khác thư mục/domain) và **production**. Tệp cấu hình ở `deploy/`. **Staging của M9 chạy chung VPS với site trường: xem mục 0.**

## 0 Chốt ở 3.8: staging trên VPS đang chạy site trường (M9)

Phần này thắng các mục 1–10 khi khác nhau, và chỉ áp dụng cho **staging**. Production chưa triển khai ở M9.

### 0.1 Ràng buộc cứng

- VPS đang chạy site trường `lms.hoctapkethop.edu.vn` (trong đó có API cũ ở cổng 4319). Staging **không được**:
  - publish cổng công khai nào. Chỉ `127.0.0.1:18080` (Caddy staging) và `127.0.0.1:19090` (Prometheus, nếu bật);
  - đọc, sửa, dừng hay xóa container, image, volume, network, cấu hình của site trường;
  - chạy `docker system prune`, `docker volume prune`, `docker image prune -a`, `docker compose down` không kèm `-p hcn-staging`, khởi động lại Docker daemon, sửa `ufw` hay `iptables`.
- Mọi lệnh compose của staging luôn có `-p hcn-staging` (diễn tập: `-p hcn-drill`). Volume, network, container do Compose tự gắn tiền tố tên project nên không trùng site trường.
- Staging **chỉ có dữ liệu tổng hợp** (mục 0.10). Không nhập dữ liệu HS thật. Không khôi phục bản sao lưu production vào staging.
- Cursor không giữ khóa, mật khẩu hay token nào của VPS, Cloudflare, S3. Cursor chỉ viết mã và tài liệu. Người vận hành (ops) làm các bước có ghi "ops làm tay".

### 0.2 Tên miền và đường đi request

| Biến | Giá trị staging |
|---|---|
| `APP_DOMAIN` | `staging-lms.hoctapkethop.edu.vn` |
| `ID_DOMAIN` | `id-staging-lms.hoctapkethop.edu.vn` |

Cả hai là subdomain **một cấp** của zone `hoctapkethop.edu.vn` để chứng chỉ miễn phí của Cloudflare (Universal SSL, `*.hoctapkethop.edu.vn`) phủ được. Tên hai cấp như `staging.lms…` bị lỗi bắt tay TLS ở Cloudflare (đã kiểm 01/10/2026).

```text
Trình duyệt ──TLS──> Cloudflare (proxied, SSL mode "Full (strict)")
          ──TLS (chứng chỉ Origin CA)──> reverse proxy sẵn có của host, cổng 443
          ──HTTP──> 127.0.0.1:18080 (Caddy staging) ──> api:3000 | keycloak:8080
```

**Reverse proxy của host** đang phục vụ site trường. Ops làm tay, một lần:

- thêm **một** tệp cấu hình mới cho hai tên staging;
- kiểm cú pháp (`nginx -t` hoặc `caddy validate`), rồi reload.

Không sửa khối cấu hình của site trường. Mẫu ở `deploy/staging/host-proxy/` (Cursor viết, xem 0.13). Yêu cầu của mẫu:

- TLS bằng `/etc/ssl/hcn-staging/origin.pem` và `origin.key`. Khóa sinh trên VPS bằng CSR, không bao giờ rời máy (không dán vào chat, Docs, GitHub).
- Lấy IP thật của người dùng từ header `CF-Connecting-IP`, và chỉ tin header này khi request đến từ dải IP của Cloudflare. Với nginx: `set_real_ip_from` + `real_ip_header CF-Connecting-IP`; danh sách dải IP sinh từ `https://www.cloudflare.com/ips-v4` và `ips-v6` lúc cài.
- Request đi tiếp tới `http://127.0.0.1:18080`:
  - giữ nguyên `Host`;
  - `X-Forwarded-Proto: https`;
  - `X-Forwarded-For` **ghi đè** bằng IP thật (không nối thêm vào giá trị client gửi);
  - `client_max_body_size 30m`;
  - `proxy_read_timeout 60s`.
- Tùy chọn: bật Authenticated Origin Pulls để chỉ Cloudflare kết nối được tới hai tên staging.

**Caddy staging** dùng `deploy/Caddyfile` đã tham số hóa:

- địa chỉ site là `{$APP_SITE_ADDRESS:{$APP_DOMAIN}}` và `{$ID_SITE_ADDRESS:{$ID_DOMAIN}}`. Ở staging, đặt hai biến này thành `http://staging-lms…` và `http://id-staging-lms…`, nên Caddy không xin ACME;
- vẫn gửi đủ header bảo mật, kể cả HSTS;
- tin X-Forwarded-* từ `private_ranges` (cổng nối Docker tới host proxy);
- `/metrics*` trả 404; trên tên ID, `/admin*` và `/realms/master*` trả 404.

**API**:

- `TRUST_PROXY` = dải mạng `edge` của project (khai báo cố định trong `compose.staging.yml`, ví dụ `172.30.18.0/24`);
- khóa giới hạn tần suất (SEC-12) dựa trên IP thật;
- giá trị `X-Forwarded-For` do client tự gửi không được tin. Có test integration cho ý này.

**Cài đặt Cloudflare cho hai tên staging** (ops làm tay):

- SSL/TLS mode **Full (strict)**; bật Always Use HTTPS;
- Cache Rule **Bypass** cho `/api/*`, `/auth/*`, `/health/*`;
- **tắt** Rocket Loader, Email Obfuscation, Web Analytics/Zaraz và mọi tính năng chèn script (phá CSP; vi phạm INV-14);
- Bot Fight Mode chặn Playwright và ZAP chạy từ GitHub. Nếu bị chặn, tạo một WAF custom rule **Skip** cho request có header `X-HCN-Probe` bằng giá trị bí mật `STAGING_PROBE_TOKEN`.

**Rủi ro cần quyết trước G4.** Với Cloudflare proxied, TLS được giải mã tại máy chủ biên của Cloudflare, có thể ở ngoài Việt Nam. Staging dùng dữ liệu tổng hợp nên chấp nhận được. Production chở dữ liệu HS thật nên phải được pháp chế nhà trường quyết định theo mục 11. Có ba lựa chọn:

- tắt proxy (DNS only) và dùng chứng chỉ ACME;
- dùng CDN hoặc proxy trong nước;
- chấp nhận có văn bản.

Đây là mục chặn G4 trong `docs/09` mục 10.

### 0.3 Thư mục, người dùng, quyền trên VPS

```text
/opt/hcn-staging/                 root:root 0755
  bin/hcn-staging                 entry duy nhất CI được gọi (root, 0755)
  bin/policy-check.sh             kiểm compose trước khi chạy (root, 0755)
  bin/lib/*.sh                    hàm dùng chung (root, 0644)
  env/staging.env                 biến không bí mật: APP_DOMAIN, ID_DOMAIN, GUARD_URL, … (0600)
  secrets/*.txt                   mật khẩu DB, cookie, OIDC… do init-secrets sinh (0600)
  secrets/pgbackrest.env          khóa S3 + cipher pass cho pgBackRest (0600)
  secrets/restic.env              khóa S3 + mật khẩu restic (0600)
  releases/<sha>/                 bundle của từng bản (deploy/, db/, perf/, manifest)
  current -> releases/<sha>       bản đang chạy
  previous -> releases/<sha>      bản trước, để hoàn tác
/var/lib/hcn-staging/metrics/backup.prom   textfile metric sao lưu
/var/log/hcn-staging/entry.log             nhật ký entry (không chứa bí mật)
```

- Người dùng `hcndeploy`:
  - không mật khẩu, không thuộc nhóm `docker`, không sudo chung;
  - `/etc/sudoers.d/hcn-staging` chỉ có `hcndeploy ALL=(root) NOPASSWD: /opt/hcn-staging/bin/hcn-staging`; kiểm bằng `visudo -cf`.
- `~hcndeploy/.ssh/authorized_keys` có đúng một dòng:
  `restrict,command="sudo /opt/hcn-staging/bin/hcn-staging" ssh-ed25519 AAAA… github-actions-staging`.
  Entry đọc `$SSH_ORIGINAL_COMMAND`. Khóa này không mở shell, không forward cổng, không dùng được cho việc gì khác.
- `deploy/staging/install.sh`: ops chạy bằng root từ một bản checkout (`git clone` vào thư mục tạm). Script idempotent và làm các việc:
  - cài `jq` và `zstd`;
  - tạo người dùng và thư mục;
  - chép `bin/` với chủ root;
  - ghi sudoers;
  - chạy `init-secrets.sh` (chỉ sinh tệp **chưa có**, không ghi đè);
  - cài systemd timer sao lưu (mục 0.8).

  CI **không** thay được mã chạy bằng root. Đổi `bin/` thì ops chạy lại `install.sh`; entry in ra cảnh báo khi `bin/` lệch với bản trong release.

### 0.4 Lệnh của entry (danh sách cho phép)

`<sha>` khớp `^[0-9a-f]{40}$`. Lệnh khác thì thoát mã 64. Mỗi lệnh ghi một dòng `entry.log`: thời điểm UTC, lệnh, sha, kết quả. Các lệnh đổi trạng thái dùng `flock /run/hcn-staging.lock`.

| Lệnh | Việc |
|---|---|
| `receive <sha>` | stdin là tar ≤ 2 GB gồm `manifest.sha256`, `images.tar.zst` (`hcn/api:<sha>`, `hcn/web:<sha>`, `hcn/postgres:18-<sha>`), `bundle.tar` (`git archive <sha> deploy db perf`). Kiểm sha256, giải vào `releases/<sha>/`, `docker load`, kiểm đúng ba tag. Giữ 3 release mới nhất; xóa image `hcn/*` của release cũ hơn bằng `docker image rm` theo tag, không prune |
| `deploy <sha>` | `preflight --quick` → `policy-check` → sao lưu `diff` nếu stanza đã có → `migrate up` → `up -d --no-build` → chờ `/health/ready` và healthcheck ≤ 5 phút → khói nội bộ (mục 8, curl qua `127.0.0.1:18080` với Host header) → đổi `previous`, `current`. Lỗi sau khi migrate: tự `rollback` app (schema giữ nguyên, nhờ quy tắc tương thích ngược ở mục 9) và thoát khác 0 |
| `rollback` | `up -d` với image của `previous`; đổi symlink |
| `status [--json]` | sha hiện tại; trạng thái container; phiên bản migration; tuổi sao lưu; `outbox_pending`, `outbox_dead`, `files_pending_scan` (đọc `/metrics` nội bộ); % đĩa, RAM còn trống |
| `seed` | chạy `seed-staging` (mục 0.10) trong container api |
| `perf <PERF-0N>` | mục 0.11 |
| `drill restore` / `drill rel06 <old_sha>` | mục 0.12; ops có thể chạy trực tiếp bằng root |
| `backup full\|diff\|files` | timer systemd gọi; ops cũng chạy tay được |

### 0.5 Kiểm chính sách compose (`policy-check.sh`)

Script lấy `docker compose -p <project> -f compose.yml -f compose.staging.yml config --format json` và **từ chối** khi có bất kỳ điều sau:

- `privileged`, `cap_add`, `devices`;
- `pid`, `ipc` hoặc `network_mode` là `host`;
- `security_opt` có `unconfined`;
- mount `/var/run/docker.sock`;
- bind mount ngoài danh sách cho phép: `releases/<sha>/`, `/opt/hcn-staging/secrets/`, `/var/lib/hcn-staging/metrics/`;
- cổng publish khác `127.0.0.1:18080` và `127.0.0.1:19090`;
- image ngoài danh sách cho phép:
  - `hcn/*:<sha>` của chính release;
  - `quay.io/keycloak/keycloak`, `clamav/clamav`, `ghcr.io/amacneil/dbmate`, `grafana/k6`, `restic/restic`, `prom/prometheus`, mỗi cái ghim theo digest `@sha256:` trong `deploy/staging/images.lock`;
- tên project khác `hcn-staging` hoặc `hcn-drill`.

Có test cho script: `deploy/staging/test/policy-check.test.sh` chạy với các compose mẫu đúng và sai, trong CI job `deploy-lint`.

### 0.6 `deploy/compose.staging.yml`

Đây là override cho `deploy/compose.yml` và cần Docker Compose ≥ 2.24. Thay đổi so với compose gốc:

- **Image**: dùng image đã build sẵn: `hcn/api:${APP_VERSION}`, `hcn/web:${APP_VERSION}` (Caddy + web tĩnh), `hcn/postgres:18-${APP_VERSION}`. Đặt `pull_policy: never` cho image `hcn/*`; image ngoài lấy theo digest.
- **Cổng**: `caddy.ports: !override ["127.0.0.1:18080:80"]`.
- **Mạng**: mạng `edge` có subnet cố định để làm `TRUST_PROXY`.
- **Dịch vụ tắt**: `node-exporter` cho vào `profiles: ["never"]` (host có thể đã có exporter riêng, và staging không được dùng `pid: host`).
- **Môi trường**:
  - `HCN_ENV=staging`, nên web hiện băng "MÔI TRƯỜNG THỬ — dữ liệu tổng hợp" ở mọi trang;
  - `FEATURE_FLAGS=insight_read=true,ai=false`;
  - `METRICS_PORT=9464`.
- **Keycloak**:
  - `kc-entrypoint.sh` render realm từ `realm-hcn.json` vào tmpfs, thay các placeholder `__APP_DOMAIN__`, `__OIDC_CLIENT_SECRET__`, `__PROVISIONER_SECRET__` bằng giá trị từ biến môi trường và secret file, rồi import;
  - không cần mở console để tạo lại secret (bỏ bước 2–3 ở mục 4 cho staging; production dùng cùng cơ chế);
  - đặt heap `JAVA_OPTS_KC_HEAP=-XX:MaxRAMPercentage=70`.
- **Sao lưu**: `db.env_file: /opt/hcn-staging/secrets/pgbackrest.env`; repo2 (mục 0.8). `api` mount `/var/lib/hcn-staging/metrics` vào `/run/hcn-metrics`, chỉ đọc.
- **Giới hạn tài nguyên** (tổng 4,75 vCPU và 5,5 GB):

| Dịch vụ | cpus | memory | Ghi chú |
|---|---|---|---|
| caddy | 0.25 | 128M | |
| api | 1.0 | 768M | |
| worker | 0.5 | 512M | |
| db | 1.5 | 1536M | `shared_buffers=384MB`, `effective_cache_size=1GB`, `max_connections=60` |
| keycloak | 1.0 | 1024M | |
| clamav | 0.5 | 1536M | REL-03 cần clamd thật |

Ngoài ra:

- `preflight.sh` (mục 0.13) từ chối nếu sau khi trừ ngân sách trên, RAM còn trống < 2 GB hoặc đĩa trống < 40 GB. Khi đó dừng và báo, không hạ giới hạn tùy tiện.
- **Hợp đồng chạy** giữa compose và code (Cursor sửa compose gốc cho khớp, có test `docker compose config` trong CI):
  - API nghe `PORT=3000`;
  - worker đọc `CLAMD_HOST`, `CLAMD_PORT`, `WORKER_DATABASE_URL_FILE`;
  - lệnh chạy là `node apps/api/src/main.ts` và `node apps/worker/src/main.ts` (Node 26 tự bỏ kiểu TS) hoặc bản build `dist/`; chọn một và ghi vào README;
  - healthcheck gọi `/health/ready`.

### 0.7 Workflow `.github/workflows/deploy-staging.yml`

**Kích hoạt**:

- `workflow_run` của `ci` khi `conclusion == success` trên `main`;
- `workflow_dispatch` (input `sha`, mặc định HEAD của `main`);
- `push` tag `v*`.

**Thiết lập job**:

- `environment: staging`. GitHub Environment `staging` chỉ cho branch `main` và tag `v*`.
- `concurrency: { group: staging, cancel-in-progress: false }`.
- `permissions: { contents: read }`.

**Chuỗi cung ứng**:

- mọi action ghim theo commit SHA;
- không dùng action SSH của bên thứ ba; dùng `ssh` của OpenSSH có sẵn trên runner;
- `StrictHostKeyChecking=yes` với `known_hosts` lấy từ secret;
- khóa SSH ghi vào `$RUNNER_TEMP` (0600) và xóa trong bước `if: always()`;
- không `set -x`.

**Các bước**:

1. Checkout đúng `sha`.
2. `docker buildx build --load` ba image, gắn tag sha.
3. Trivy quét ba image: `--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`; báo cáo SARIF lưu artifact.
4. `docker save | zstd`; `git archive`; tạo manifest.
5. `ssh … receive <sha> < release.tar`
6. `ssh … deploy <sha>`
7. Khói từ runner, qua Cloudflare:
   - các curl ở mục 8 (`/health/ready` 200; CSP có mặt; `/api/v1/me` 401; `https://$ID_DOMAIN/admin/` 404; `https://$APP_DOMAIN/metrics` 404; `https://$ID_DOMAIN/realms/master/` 404);
   - Playwright `@smoke` (`BASE_URL=https://$APP_DOMAIN`, tài khoản khói, header `X-HCN-Probe` nếu có token).
8. Khói lỗi → `ssh … rollback`, job fail.

**Secret và biến** (Environment `staging`): bảng ở mục 0.14.

**Workflow `ops-staging-nightly.yml`** (00:15 UTC, tức 07:15 giờ Việt Nam):

- `ssh … status --json` và khẳng định:
  - sao lưu `pg_full` ≤ 8 ngày, `pg_diff` ≤ 26 giờ, `files` ≤ 26 giờ;
  - `outbox_dead == 0`; đĩa < 80%; `/health/ready` 200;
- ZAP baseline tới `https://$APP_DOMAIN` (thụ động, không quét chủ động);
- lỗi thì workflow đỏ và GitHub gửi email cho người theo dõi repo. Không gửi dữ liệu HS (staging chỉ có dữ liệu tổng hợp).

**Workflow `nightly.yml`** (trên runner, không đụng VPS):

- Schemathesis SEC-14 với stack compose dựng trong runner;
- E2E đủ trình duyệt;
- REL-01…04 (mục 0.12).

### 0.8 Sao lưu staging ra kho S3 trong nước

- **Kho**:
  - bucket riêng `hcn-staging-backup` ở nhà cung cấp S3-compatible **đặt tại Việt Nam** (Viettel IDC, VNPT, FPT Cloud, BizFly…);
  - access key chỉ có quyền trên bucket này;
  - bật versioning hoặc object lock nếu nhà cung cấp hỗ trợ (chống xóa bởi kẻ chiếm máy);
  - production sau này dùng bucket và key khác.
- **pgBackRest repo2**: `pgbackrest.conf` giữ giá trị mặc định; biến môi trường ghi đè từ `secrets/pgbackrest.env`:
  - `PGBACKREST_REPO2_S3_ENDPOINT`, `PGBACKREST_REPO2_S3_BUCKET`, `PGBACKREST_REPO2_S3_REGION`;
  - `PGBACKREST_REPO2_S3_KEY`, `PGBACKREST_REPO2_S3_KEY_SECRET`;
  - `PGBACKREST_REPO2_S3_URI_STYLE=path` (đa số kho trong nước cần);
  - `PGBACKREST_REPO2_PATH=/pg`, `PGBACKREST_REPO2_CIPHER_PASS`.

  `stanza-create` và `check` do `install.sh` hướng dẫn ops chạy sau lần deploy đầu.
- **restic** cho volume `hcn-staging_files`:

  ```bash
  docker run --rm --env-file /opt/hcn-staging/secrets/restic.env \
    -v hcn-staging_files:/data:ro restic/restic@sha256:<digest> backup /data --tag files
  ```

  - `RESTIC_REPOSITORY=s3:https://<endpoint>/hcn-staging-backup/files`; thêm `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`;
  - `forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune` chạy chủ nhật;
  - `check --read-data-subset=5%` chạy ngày 1 hằng tháng.
- **Lịch** (systemd timer, giờ máy UTC):

| Việc | Giờ máy (UTC) | Giờ Việt Nam |
|---|---|---|
| `pg_full` | 18:00 thứ bảy | 01:00 chủ nhật |
| `pg_diff` | 18:00 các ngày khác | 01:00 |
| `files` | 18:30 hằng ngày | 01:30 |

  Có `RandomizedDelaySec=300` và `Nice=10` để không giành tài nguyên với site trường.
- **Metric**:
  - chỉ khi sao lưu thành công, script ghi nguyên tử (ghi tệp tạm rồi `mv`) vào `/var/lib/hcn-staging/metrics/backup.prom` hai dòng: `hcn_last_backup_timestamp_seconds{kind="pg_full|pg_diff|files"}` và `hcn_last_backup_success{kind=…} 1`;
  - API đọc tệp này mỗi lần scrape và xuất `hcn_last_backup_age_seconds{kind}` (docs/02 mục 9). Thiếu tệp thì không xuất giá trị, **không** xuất 0 (INV-12).
- **Ký gửi bí mật**: `PGBACKREST_REPO2_CIPHER_PASS`, `RESTIC_PASSWORD` và khóa S3 phải có bản sao trong kho mật khẩu của trường, không chỉ nằm trên VPS. Mất VPS mà không có bản sao này thì bản sao lưu ngoài máy vô dụng. Diễn tập REL-05 dùng **bản ký gửi**, không dùng bản trên VPS, nhờ vậy kiểm luôn việc ký gửi.

### 0.9 `/metrics` (SEC-21)

- API phục vụ metrics trên **listener riêng** `METRICS_PORT=9464`, trong container, chỉ trên mạng `internal`. Caddy không định tuyến tới cổng này và vẫn chặn `/metrics*` trên cổng chính.
- Thư viện: đặc tả này duyệt dùng `prom-client`, hoặc tự viết bộ định dạng text exposition; không thêm thư viện khác.
- Metric:
  - `http_request_duration_seconds` (histogram). Nhãn: `method`, `route` (mẫu route, không chứa ID), `status_class`;
  - `hcn_db_pool_total`, `hcn_db_pool_idle`, `hcn_db_pool_waiting`;
  - `hcn_outbox_pending`, `hcn_outbox_dead`, `hcn_files_pending_scan` (đếm bằng truy vấn có chỉ mục, cache 15 giây);
  - `hcn_last_backup_age_seconds{kind}`.
- Không nhãn nào chứa user id, school id hay đường dẫn có ID (INV-13).
- `/health/ready`: kiểm DB (`SELECT 1` với timeout 1 giây) và đọc được issuer OIDC đã cache. Trả 503 kèm `{status, checks}`, không lộ chi tiết lỗi. Gỡ `x-milestone` của `healthReady` trong `openapi.yaml`.
- Prometheus (tùy chọn, profile `monitoring`): `prom/prometheus` trong mạng `internal`, publish `127.0.0.1:19090`; ops xem qua `ssh -L 19090:127.0.0.1:19090`. Alertmanager để M10.

### 0.10 Dữ liệu tổng hợp trên staging

CLI `seed-staging` (gọi qua `entry seed`):

- **Chặn môi trường**: từ chối nếu `HCN_ENV != 'staging'`.
- **Tổ chức**: trường `STAGING` "Trường thử nghiệm (dữ liệu tổng hợp)", một năm học, 27 lớp × 45 HS = 1 215 HS (≥ 1 200), 60 GV, 300 PH.
- **Học liệu**: offering Tin học 10 dùng module seed đã duyệt (M-TIN10-CAULENH và các module seed khác đã có). Không bịa YCCĐ, KC (AGENTS.md mục 7).
- **Lịch sử**: ~10 000 bài nộp và ~200 000 quan sát (docs/09 mục 7), sinh **qua use case** (không INSERT thẳng) để giữ đủ audit, outbox và trigger. Được chạy theo lô; worker xử lý dần.
- **Tên và tài khoản**:
  - tên ghép từ danh sách âm tiết cố định, có seed để tái lập;
  - username `stg.hs0001`…, `stg.gv001`…, `stg.ph001`…;
  - tạo người dùng Keycloak qua provisioner; mọi tài khoản tổng hợp dùng chung mật khẩu trong `secrets/synthetic_user_password.txt`.
- **Tài khoản khói**: `stg.smoke.hs`, `stg.smoke.gv`, trong offering "KIỂM THỬ" (docs/08 mục 8); mật khẩu ở `secrets/smoke_*_password.txt`, ops chép sang GitHub secret.
- **Chạy lại**: idempotent, không tạo trùng.

### 0.11 Hiệu năng trên máy dùng chung (PERF-01…05)

- **Nơi chạy**: k6 chạy **trên VPS** qua `entry perf PERF-0N`:
  - `docker run --rm --cpus 1 --memory 512m --network host grafana/k6@sha256:…`;
  - option `hosts` của k6 ánh xạ `APP_DOMAIN` và `ID_DOMAIN` về `127.0.0.1`, nên đo qua host proxy, không qua Cloudflare. Như vậy không kích hoạt chống DDoS và đo đúng máy chủ;
  - `insecureSkipTLSVerify` chỉ hợp lệ vì đích là loopback.
- **Khung giờ**: chỉ 22:00–05:00 giờ Việt Nam. Ngoài khung, entry từ chối, thoát mã 75.
- **Bảo vệ site trường**:
  - trong lúc chạy, một vòng lặp gửi `GET $GUARD_URL` mỗi 5 giây (`GUARD_URL=https://lms.hoctapkethop.edu.vn/` trong `staging.env`; chỉ đọc trang chủ, không đăng nhập);
  - nếu 2 lần liên tiếp chậm hơn 3 giây hoặc trả mã ≥ 400 → `docker kill` k6; kết quả ghi `aborted_guard`, không tính là đạt hay trượt.
- **Kịch bản**:
  - `perf/lib/login.js` đăng nhập OIDC thật bằng form Keycloak, mỗi VU một lần;
  - `perf/perf-0N.js` mang ngưỡng của docs/09 mục 7 làm `thresholds`;
  - PERF-03 đối soát bằng role `hcn_readonly`: đúng 200 `submission_versions` mới trong cửa sổ chạy, 0 trùng;
  - PERF-04 theo dõi `hcn_outbox_pending` về 0 trong 2 phút.
- **Báo cáo**: entry in tóm tắt JSON (thêm `pg_stat_statements` top 10; cần `shared_preload_libraries=pg_stat_statements` ở staging). Workflow `perf-staging.yml` (chỉ `workflow_dispatch`) lưu tóm tắt thành artifact. Cursor viết `docs/qa/releases/<ver>/perf.md` gồm:
  - cấu hình máy và giới hạn mục 0.6;
  - sha, dữ liệu, kết quả, nút thắt.
- **Diễn giải**: staging bị giới hạn ~4,75 vCPU trên máy dùng chung. Đạt ngưỡng ở đây là kết quả thận trọng cho production. Trượt thì báo cáo và tìm nút thắt; không nới giới hạn quá ngân sách mục 0.6.

### 0.12 Tin cậy, khôi phục, migration (REL-01…06, AC13, A09, A10)

**REL-01…04**: chạy trên runner (`nightly.yml` và job `resilience` khi PR đổi `deploy/`, `apps/worker/`, `apps/api/src/plugins/`), với stack compose dựng từ image vừa build; không chạy trên VPS.

| Ca | Cách làm |
|---|---|
| REL-01 | `docker compose stop worker` 10 phút giữa lúc nộp và công bố, rồi `start`; khẳng định không mất bài và thông báo không trùng |
| REL-02 | `HCN_FAULT_AFTER_COMMIT=submitAssignment` làm API `process.exit(1)` ngay sau commit; client gửi lại cùng `Idempotency-Key` → một phiên bản, cùng biên nhận. Biến này chỉ được chấp nhận khi `HCN_ENV=test`; config từ chối ở `staging` và `production` (như `HCN_CLOCK_FILE`), và có test cho việc từ chối |
| REL-03 | Dừng clamav |
| REL-04 | Dừng keycloak; phiên cũ vẫn gọi API được; trang đăng nhập báo lỗi thân thiện |

**`drill restore`** (REL-05 mức staging, AC13, A09): ops chạy bằng root, truyền bí mật **ký gửi** qua `--escrow /root/escrow.env` (tệp tạm, xóa sau).

1. Dựng project `hcn-drill` với volume mới. Caddy drill không publish cổng; khói chạy bằng `docker compose exec`.
2. `pgbackrest --repo=2 --type=time --target=<T> restore` từ S3, rồi `restic restore latest` từ S3.
3. Khởi động và chạy khói.
4. Chạy CLI `verify-files`: với mọi hàng `files`, tệp tồn tại và `sha256` khớp `content_hash` → 0 thiếu, 0 lệch. Với mọi `submission_version_files`, mở được.
5. In RTO (từ lúc bắt đầu tới khi khói đạt) và RPO (T so với giao dịch commit cuối trong bản gốc). Cursor ghi `docs/ops/restore-drill-<ngày>.md`.
6. `docker compose -p hcn-drill down -v`.

Diễn tập trên cùng VPS chỉ đạt REL-05 ở mức **M9/G3**. **G4** phải lặp lại trên máy trống thật theo mục 6.

**`drill rel06 <old_sha>`** (REL-06, A10):

1. Khôi phục bản sao lưu staging mới nhất vào `hcn-drill`.
2. `migrate up` bằng release hiện tại.
3. Khởi động **image API và worker của `old_sha`** trên schema mới; chạy khói.
4. Chạy `db/checks/release_id_semantics.sql` (Cursor viết; chỉ đọc). Kiểm rằng mọi `submissions`, `quiz_attempts`, `activity_progress` vẫn trỏ đúng `module_release_id` và `module_version_id` như trước migration (so với bảng chụp lấy trước bước 2).
5. Dọn `hcn-drill`.

### 0.13 Tệp Cursor viết cho M9

```text
deploy/api/Dockerfile                 multi-stage, node:26-bookworm-slim, USER 10001, pnpm deploy --prod, không có devDependencies
deploy/web/Dockerfile                 stage build apps/web, stage caddy:2 (digest) + /srv/web; tên image hcn/web
deploy/compose.staging.yml            mục 0.6
deploy/Caddyfile                      tham số hóa site address (mục 0.2)
deploy/keycloak/kc-entrypoint.sh      render realm (mục 0.6); realm-hcn.json dùng placeholder
deploy/staging/preflight.sh           chỉ đọc (mục 0.13 dưới)
deploy/staging/install.sh, init-secrets.sh, bin/hcn-staging, bin/policy-check.sh, bin/lib/*.sh
deploy/staging/systemd/*.service, *.timer
deploy/staging/host-proxy/nginx-staging.conf, caddy-staging.caddyfile   mẫu, ops áp dụng tay
deploy/staging/images.lock            digest image ngoài
deploy/staging/test/*.sh              test policy-check, test entry (mô phỏng SSH_ORIGINAL_COMMAND)
.github/workflows/deploy-staging.yml, ops-staging-nightly.yml, perf-staging.yml, nightly.yml
perf/lib/*.js, perf/perf-01.js … perf-05.js
tests/resilience/*                    REL-01…04
docs/ops/staging-runbook.md           cài lần đầu, deploy, hoàn tác, sự cố riêng cho staging
```

Ràng buộc:

- **Shell**: mọi script có `set -euo pipefail` và qua `shellcheck` (job `deploy-lint` trong `ci.yml`, cùng `docker compose config` và hadolint).
- **`preflight.sh`**: chỉ đọc, không cần mạng. In ra:
  - Ubuntu version; Docker và Compose version (Compose ≥ 2.24);
  - `nproc`, `MemAvailable`, đĩa trống của `/var/lib/docker`;
  - các cổng 80, 443, 18080, 19090 đang nghe (`ss -ltnp`), và tiến trình đang giữ cổng 443;
  - `docker compose ls`; `ufw status`.

  Mã thoát:

| Mã | Nghĩa |
|---|---|
| 0 | Đạt |
| 10 | Cổng 18080 hoặc 19090 đã bị dùng |
| 11 | Thiếu tài nguyên theo mục 0.6 |
| 12 | Cổng 443 do một container giữ (proxy của site trường chạy trong Docker). Thêm site vào đó là sửa cấu hình site trường, nên **dừng và hỏi người điều phối** |
| 13 | Compose < 2.24 |
| 14 | Subnet `172.30.18.0/24` trùng network Docker hoặc route của host (3.8.1, D06) |

  Ops chạy trước khi cài và dán kết quả vào báo cáo M9 (không có bí mật trong đầu ra).

### 0.14 Ops chuẩn bị (không phải việc của Cursor)

| Việc | Ghi chú |
|---|---|
| DNS Cloudflare | A `staging-lms` và A `id-staging-lms` → IP VPS, Proxied |
| Chứng chỉ Origin | Sinh khóa và CSR **trên VPS**; Cloudflare "Use my private key and CSR", hostnames là hai tên trên; chỉ chép chứng chỉ về `/etc/ssl/hcn-staging/origin.pem` |
| Host proxy | Chạy `preflight.sh`; áp mẫu `deploy/staging/host-proxy/*` thành một tệp mới; kiểm cú pháp rồi reload |
| Kho S3 trong nước | Bucket `hcn-staging-backup`, access key riêng; điền `secrets/pgbackrest.env`, `secrets/restic.env`; ký gửi vào kho mật khẩu trường |
| Khóa SSH deploy | `ssh-keygen -t ed25519 -N '' -C github-actions-staging -f hcn_staging_deploy`; public key vào `authorized_keys` của `hcndeploy` theo mục 0.3; private key vào GitHub secret rồi xóa bản trên máy |
| GitHub Environment `staging` | Bảng dưới |

**Secret** (Settings → Environments → staging):

| Secret | Giá trị |
|---|---|
| `STAGING_SSH_HOST` | IP VPS (không dùng tên qua Cloudflare, vì Cloudflare không chuyển SSH) |
| `STAGING_SSH_PORT` | Cổng SSH |
| `STAGING_SSH_USER` | `hcndeploy` |
| `STAGING_SSH_KEY` | Private key ed25519 ở trên |
| `STAGING_SSH_KNOWN_HOSTS` | Đầu ra `ssh-keyscan -t ed25519 -p <port> <IP>`, đối chiếu với `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` trên VPS |
| `STAGING_SMOKE_HS_PASSWORD`, `STAGING_SMOKE_GV_PASSWORD` | Từ `secrets/smoke_*_password.txt` sau lần `seed` đầu |
| `STAGING_PROBE_TOKEN` | Tùy chọn, chỉ khi cần WAF Skip (mục 0.2) |

**Biến** (vars): `STAGING_APP_DOMAIN`, `STAGING_ID_DOMAIN`.

**Cổng SSH**: nếu `ufw` đang giới hạn 22/tcp theo IP văn phòng, runner GitHub sẽ không vào được. Ops chọn một trong ba:

- mở 22/tcp (giữ khóa SSH bắt buộc, fail2ban, và khóa `restrict` ở mục 0.3);
- dùng self-hosted runner trong mạng trường (để M10);
- giữ chặn và deploy bằng `workflow_dispatch` từ máy ops (không khuyến nghị).

### 0.15 Chốt ở 3.8.1 (sau review PR #7)

Mục này bổ sung cho 0.2–0.12; ở điểm nào khác nhau thì mục này thắng. Mỗi dòng có một test tự động (`deploy/staging/test/*.sh` hoặc job CI), trừ các dòng ghi "ops".

**Entry và quyền root**

| Mã | Yêu cầu | Lý do |
|---|---|---|
| D01 | `/etc/sudoers.d/hcn-staging` có thêm `Defaults!/opt/hcn-staging/bin/hcn-staging env_keep += "SSH_ORIGINAL_COMMAND"` (vẫn kiểm bằng `visudo -cf`). `entry.test.sh` chạy entry qua `sudo` thật trong container test (hoặc giả lập `env -i`) để chứng minh lệnh còn tới được entry | Mặc định `sudo` (`env_reset`) xóa `SSH_ORIGINAL_COMMAND`, nên mọi lệnh qua SSH đều thoát 64 |
| D02 | Entry **không bao giờ** chạy tệp lấy từ `releases/`. Ba thứ dùng bản đã cài trong `/opt/hcn-staging/bin/`: `preflight.sh`, `policy-check.sh` và `images.lock`. Release chỉ cung cấp compose, Caddyfile, `db/`, `perf/`. Đổi `images.lock` = ops chạy lại `install.sh` | Release do CI tạo; chạy script của release bằng root là cho CI quyền root. Lấy `images.lock` từ release cũng cho CI tự mở danh sách image |
| D03 | `receive` đọc `manifest.json` trong tar của `docker save` **trước** `docker load` (`zstd -dc … \| tar -xO manifest.json`). Tập `RepoTags` phải đúng bằng `{hcn/api:<sha>, hcn/web:<sha>, hcn/postgres:18-<sha>}`; khác thì từ chối, không load | `docker load` ghi đè bất kỳ tag nào có trong tar, kể cả image mà site trường đang dùng |
| D04 | `policy-check` từ chối thêm các trường hợp: `pid`, `ipc`, `network_mode` có bất kỳ giá trị nào (kể cả `container:…`); `volumes_from`; `userns_mode`; `cgroup_parent`; `build`. Volume top-level có `external`, có `driver_opts`, hoặc có `name` không bắt đầu bằng `<project>_`. Network top-level có `external` hoặc driver khác `bridge`. `secrets`/`configs` top-level có `file` nằm ngoài `/opt/hcn-staging/secrets/` hoặc ngoài thư mục release | Các đường này vẫn gắn được volume, network hay namespace của site trường, hoặc bind `/` qua `driver_opts` |
| D05 | `compose.staging.yml` khai báo lại **mọi** `secrets` top-level, trỏ tới `/opt/hcn-staging/secrets/<tên>.txt` | Compose gốc trỏ `./secrets/…` trong release, thư mục này không tồn tại nên deploy đầu tiên sẽ lỗi |
| D06 | `preflight.sh` kiểm subnet `172.30.18.0/24` không trùng network Docker nào (`docker network inspect`) và không trùng route của host; trùng thì thoát **14** (bổ sung bảng mã ở 0.13) | `compose up` báo "Pool overlaps" nếu site trường đã dùng dải này |

**Workflow**

| Mã | Yêu cầu |
|---|---|
| W01 | Job deploy khi kích hoạt bằng `workflow_run` thêm điều kiện `github.event.workflow_run.event == 'push'` và `github.event.workflow_run.head_repository.full_name == github.repository`. Lý do: một fork có nhánh tên `main` cũng khớp bộ lọc `branches`, và job `workflow_run` chạy trong ngữ cảnh nhánh mặc định nên vượt qua được bảo vệ Environment |
| W02 | `workflow_dispatch` với `sha` tùy chọn: sau checkout, bắt buộc `git merge-base --is-ancestor "$sha" origin/main` hoặc `sha` là commit của một tag `v*`; không thỏa thì fail trước khi build |
| W03 | Secret đưa vào bước qua `env:` rồi dùng `"$VAR"`, không chèn `${{ secrets.* }}` thẳng vào thân script |

**Host proxy (ops áp dụng, Cursor sinh mẫu)**

| Mã | Yêu cầu |
|---|---|
| H01 | Mẫu nginx không được để trống `set_real_ip_from`. Thêm `deploy/staging/host-proxy/render.sh`: tải `ips-v4` và `ips-v6` của Cloudflare lúc chạy, sinh tệp hoàn chỉnh vào stdout để ops xem rồi mới chép. Thiếu danh sách thì `$remote_addr` là IP của Cloudflare, và giới hạn tần suất (SEC-12) sẽ gộp mọi người dùng vào vài IP |
| H02 | Mẫu thêm `listen [::]:443 ssl;` và `http2 on;`, cùng các header `X-Forwarded-Proto`, `X-Forwarded-For` (ghi đè), `Host` như mục 0.2 |

**Sao lưu, hiệu năng, diễn tập**

| Mã | Yêu cầu |
|---|---|
| B01 | Thêm timer cho restic: `forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune` vào chủ nhật 19:00 UTC; `check --read-data-subset=5%` vào ngày 1 hằng tháng, 19:30 UTC. Thêm lệnh entry `backup files-maintain` (vào danh sách cho phép ở 0.4) |
| P01 | `perf`: kết quả không được mất. Gồm `--summary-export` ra thư mục mount từ `releases/<sha>/perf-out/`, cùng `docker logs` trước khi `rm`. Entry in tóm tắt JSON ra stdout |
| P02 | Mỗi VU đăng nhập **một lần** (trong `setup` hoặc lần lặp đầu của VU), bằng tài khoản `stg.hs%04d` theo `__VU` và mật khẩu `synthetic_user_password`, truyền qua tệp mount chỉ đọc, không qua `-e`. Login phải submit theo `action` của form Keycloak (đọc từ HTML), không post vào URL trang. Kiểm có cookie phiên trước khi chạy tải |
| P03 | Kịch bản gọi **API** theo docs/09 mục 7 (ví dụ PERF-01: `/api/v1/me`, Hôm nay, mở bài, mở mục). Không đo HTML SPA tĩnh. `check` yêu cầu 2xx. PERF-03 đối soát bằng `hcn_readonly`: đúng 200 phiên bản, 0 trùng. PERF-04 chờ `hcn_outbox_pending` về 0 |
| P04 | Ánh xạ tên miền về `127.0.0.1` bằng `options.hosts` trong script (không giả định có cờ CLI; kiểm bằng `k6 run --help` của đúng image trong `images.lock`) |
| S01 | `seed-staging` sinh lịch sử ~10 000 bài nộp và ~200 000 quan sát **qua use case** (docs/08 mục 0.10). Không có lịch sử thì PERF-05 (bản đồ nhiệt) không có ý nghĩa |
| R01 | `drill restore` và `drill rel06` phải **cài thật** theo 0.12. Mã 75 chỉ dùng khi thiếu tệp `--escrow`. Một lệnh in thông báo rồi thoát không được coi là đã có diễn tập |
| R02 | REL-01…04 là test chạy được trong `nightly.yml` và job `resilience`, không phải tệp ghi chú |

PR M9 chỉ được coi là xong khi D01–D06, W01–W03, H01–H02 đã có test. Các mục B, P, S, R là điều kiện của cổng G3 (mục "Hoàn thành khi" của M9 ở docs/10).

### 0.16 Chốt ở 3.8.2 (review PR #7 lần 2: diễn tập và entry)

Mục này thắng 0.12 và 0.15 (R01) ở các điểm khác nhau. D01–D06, W01–W03, H01–H02 của 0.15 đã đạt ở commit 1651835.

| Mã | Yêu cầu | Lý do |
|---|---|---|
| X01 | `use_current` đặt và export `APP_VERSION=$(basename current)`. Mọi lệnh gọi compose (`status`, `backup`, `seed`, `perf`, `drill`) đều chạy với một phiên bản xác định. Test dùng `docker compose config` **thật**, không dùng docker giả | Không có biến này thì `image: hcn/api:` rỗng, nên các lệnh sau lần deploy đầu (timer sao lưu, nightly) sẽ hỏng |
| X02 | Project `hcn-drill` dùng thêm override riêng `deploy/staging/compose.drill.yml`: `caddy.ports: !reset []`; db chạy với `archive_mode=off` và không mount `pgbackrest.env` của staging. policy-check áp cho cả bộ ba tệp | Override staging publish `127.0.0.1:18080`, trùng với staging đang chạy. Nghiêm trọng hơn: db diễn tập bật `archive_command` sẽ đẩy WAL của timeline đã rẽ nhánh vào **chính kho S3 của staging** |
| X03 | pgBackRest và restic trong diễn tập lấy khóa S3, `CIPHER_PASS` và `RESTIC_PASSWORD` **từ tệp `--escrow`**, truyền qua `--env-file` tạm (0600, xóa khi xong). Không đọc `/opt/hcn-staging/secrets/pgbackrest.env` hay `restic.env` | Diễn tập phải chứng minh bản ký gửi dùng được (0.8) |
| X04 | Khôi phục DB bằng container chạy một lần **trước** khi PostgreSQL khởi động: `run --rm --no-deps db pgbackrest … restore` vào volume trống, rồi mới `up -d db` | pgBackRest không khôi phục vào cụm đang chạy, và initdb đã ghi vào volume |
| X05 | restic: `restore latest:/data --target /data` (cú pháp thư mục con, restic ≥ 0.17) hoặc `--target /` | `restore latest --target /data` với snapshot của `/data` sẽ tạo `/data/data/…`, và `verify-files` sẽ báo thiếu toàn bộ |
| X06 | RPO: lấy thời điểm commit cuối của staging (`max(created_at)` của `audit_log`, đọc bằng `hcn_readonly` **trước** khi diễn tập) so với commit cuối có trong bản khôi phục. In `rpo_seconds` cùng `rto_seconds` | 0.12 bước 5 yêu cầu cả hai số |
| X07 | `drill rel06`: sau khôi phục và **trước** `migrate up`, tạo `release_id_snapshot` (bảng tạm trong DB diễn tập, chủ là `postgres`) từ `submissions`, `quiz_attempts`, `activity_progress` nối `module_releases`; sau migrate, chạy `db/checks/release_id_semantics.sql`. Khôi phục theo X04 | Hiện không có bước tạo snapshot nên kiểm tra luôn báo thiếu bảng |
| X08 | Job `drill-e2e` trong `nightly.yml` chạy trên runner. MinIO chỉ dùng làm S3 giả trong runner; không phải dịch vụ triển khai, không cần ADR. Các bước: dựng stack, seed nhỏ, `backup full` + `files`, ghi thêm dữ liệu, `drill restore` với tệp escrow giả. Khẳng định: `verify-files` 0 thiếu 0 lệch; RPO, RTO có số; **không có object WAL mới** trong kho staging sau diễn tập (X02). Chạy thêm `drill rel06` với hai sha liên tiếp | Test với docker giả không bắt được X01–X07 |

R01 của 0.15 chỉ coi là đạt khi `drill-e2e` xanh. Sau đó ops mới chạy diễn tập trên VPS.

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
