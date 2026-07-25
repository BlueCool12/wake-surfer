FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=development

COPY --chown=node:node artifact/ ./

USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
