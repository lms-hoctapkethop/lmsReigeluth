# Ảnh API và worker. Node 26 bỏ kiểu TypeScript (NODE_OPTIONS).
# pnpm deploy --prod tạo gói API khép kín ở /opt/api-deploy; tiến trình chạy
# từ cây repo /app vì worker nằm cạnh API (xem README).
FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --prod \
 && pnpm --filter @hcn/api deploy --prod /out

FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin hcn
WORKDIR /app
COPY --from=build --chown=hcn:hcn /src /app
COPY --from=build --chown=hcn:hcn /out /opt/api-deploy
ENV NODE_OPTIONS=--experimental-strip-types
USER 10001
