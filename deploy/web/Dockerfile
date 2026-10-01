# Ảnh hcn/web: web tĩnh + Caddy.
FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS build
WORKDIR /src
RUN npm install -g pnpm@10.33.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile && pnpm --filter web build

FROM caddy:2@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52
COPY --from=build /src/apps/web/dist /srv/web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
