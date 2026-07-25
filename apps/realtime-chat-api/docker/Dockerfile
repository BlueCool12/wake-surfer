FROM node:24-alpine AS builder

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/realtime-chat-api ./apps/realtime-chat-api

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wake-surfer/realtime-chat-api build:bundle

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /workspace/apps/realtime-chat-api/dist/main.mjs ./dist/main.mjs

USER node

EXPOSE 3000

CMD ["node", "dist/main.mjs"]
