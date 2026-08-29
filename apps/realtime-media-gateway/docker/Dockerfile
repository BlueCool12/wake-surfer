# mediasoup은 컴파일된 네이티브 바이너리(mediasoup-worker)가 필요하다. macOS 호스트에서 만든
# 바이너리는 Linux 컨테이너에서 못 돌기 때문에, 다른 앱들과 달리 이 파일만 멀티스테이지다.
#
# `npm install`이 트리거하는 mediasoup의 postinstall은 GitHub에서 이 플랫폼용 prebuilt
# 바이너리를 내려받고, 실패할 때만 로컬 컴파일로 폴백한다(build-essential·python3는 그 폴백용
# 안전망). glibc 링킹을 맞추려고 alpine이 아니라 Debian 계열을 쓴다.
FROM node:24-bookworm-slim AS worker

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /worker
RUN npm init -y >/dev/null && npm install mediasoup@3.19.17
RUN test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
# mediasoup JS는 dist/main.mjs에 번들돼 있다. 바이너리 경로만 환경변수로 알려주면 mediasoup의
# 기본 경로 탐색(자기 패키지 디렉터리 기준 상대 경로) 없이 바로 이 파일을 쓴다.
ENV MEDIASOUP_WORKER_BIN=/app/mediasoup-worker

COPY --from=worker --chown=node:node \
  /worker/node_modules/mediasoup/worker/out/Release/mediasoup-worker ./mediasoup-worker
COPY --chown=node:node dist/main.mjs ./dist/main.mjs

USER node

EXPOSE 4000
EXPOSE 44444/udp
EXPOSE 44444/tcp

CMD ["node", "dist/main.mjs"]
