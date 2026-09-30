# Học cùng nhau

Repo được làm mới theo bộ đặc tả triển khai 3.0 (30/09/2026). Web Next.js cũ đã được gỡ. Mã hiện tại là mốc **M0**: monorepo pnpm, schema SQL trong `db/migrations/`, 37 vector hàm thuần, và `GET /health/live`.

Mốc M1 đến M10 chưa làm. Không nhảy mốc.

## Chạy

```bash
pnpm install
pnpm verify
pnpm dev
```

`pnpm dev` mở API tại http://127.0.0.1:4319/health/live

`pnpm db:migrate` cần lệnh `dbmate` và `DATABASE_URL`. Máy không có Docker thì chưa chạy được DB01–DB16. Seed chương trình thuộc mốc M2.

Node đích của đặc tả là 26 sau khi vào LTS. M0 đang chạy trên Node 22.

## Tài liệu

Luật viết mã: `AGENTS.md`. Lộ trình: `docs/10-lo-trinh-cho-cursor.md`.
