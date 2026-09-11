FROM node:24-bookworm-slim AS base

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS workspace

RUN npm install --global pnpm@11.7.0

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/auth-api/package.json ./apps/auth-api/package.json
COPY packages/oauth/package.json ./packages/oauth/package.json
COPY apps/auth-api/prisma ./apps/auth-api/prisma

FROM workspace AS dependencies

RUN pnpm install --frozen-lockfile --prod --filter @wake-surfer/auth-api...
RUN npx --yes prisma@6.19.3 generate --schema=apps/auth-api/prisma/schema.prisma

COPY apps/auth-api/dist ./apps/auth-api/dist
COPY packages/oauth/dist ./packages/oauth/dist

FROM workspace AS migration

RUN pnpm install --frozen-lockfile --filter @wake-surfer/auth-api

WORKDIR /workspace/apps/auth-api

CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM base AS runtime

WORKDIR /app/apps/auth-api

ENV NODE_ENV=production

COPY --from=dependencies --chown=node:node /workspace /app

USER node

EXPOSE 3002

CMD ["node", "dist/main.js"]
