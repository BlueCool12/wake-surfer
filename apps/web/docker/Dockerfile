FROM node:24-alpine AS builder

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile

ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm --filter web build

FROM nginx:1.29-alpine AS runtime

COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/web/dist/ /usr/share/nginx/html/

EXPOSE 80
