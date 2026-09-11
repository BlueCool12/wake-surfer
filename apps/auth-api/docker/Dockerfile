FROM node:24-bookworm-slim AS dependencies

RUN npm install --global pnpm@11.7.0

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/auth-api/package.json ./apps/auth-api/package.json
COPY packages/oauth/package.json ./packages/oauth/package.json
COPY apps/auth-api/prisma ./apps/auth-api/prisma

RUN pnpm install --frozen-lockfile --prod --filter @wake-surfer/auth-api...
RUN npx --yes prisma@6.19.3 generate --schema=apps/auth-api/prisma/schema.prisma

COPY apps/auth-api/dist ./apps/auth-api/dist
COPY packages/oauth/dist ./packages/oauth/dist

FROM node:24-bookworm-slim AS runtime

WORKDIR /app/apps/auth-api

ENV NODE_ENV=production

COPY --from=dependencies --chown=node:node /workspace /app

USER node

EXPOSE 3002

CMD ["node", "dist/main.js"]
