# Học cùng nhau

Repo được làm mới theo bộ đặc tả triển khai 3.0 (30/09/2026). Mốc hiện tại là **M1**: đăng nhập OIDC, phiên `hcn_sid`, CSRF, và chọn ngữ cảnh. Mốc M2 trở đi chưa làm.

## Chạy

```bash
pnpm install
pnpm verify
pnpm dev
```

`pnpm dev` mở API tại http://127.0.0.1:4319/health/live. Giao diện: `pnpm --filter web dev` tại http://localhost:5173.

`pnpm db:migrate` cần lệnh `dbmate` và `DATABASE_URL`. DB01–DB16 chạy trên Postgres 18 trong CI, hoặc trên Postgres cài sẵn (schema không dùng tính năng riêng của 18). `packages/testkit` chỉ mở Postgres 18 khi có Docker và `dbmate`; không có Docker thì ca đó được bỏ qua ở máy local và bắt buộc phải chạy trên CI. Seed chương trình thuộc mốc M2.

Node đích của đặc tả là 26 sau khi vào LTS. M1 đang chạy trên Node 22.

## Tài liệu

Luật viết mã: `AGENTS.md`. Lộ trình: `docs/10-lo-trinh-cho-cursor.md`.
