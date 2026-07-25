FROM node:24-alpine

WORKDIR /app/apps/realtime-chat-gateway

ENV NODE_ENV=development

COPY --chown=node:node artifact/ /app/

USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
