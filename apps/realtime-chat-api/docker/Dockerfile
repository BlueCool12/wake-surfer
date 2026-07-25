FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --chown=node:node dist/main.mjs ./dist/main.mjs

USER node

EXPOSE 3000

CMD ["node", "dist/main.mjs"]
