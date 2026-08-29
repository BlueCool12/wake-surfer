# web app

React·Vite 기반 wake-surfer 웹 앱이다.

## Docker 배포

`docker/`가 정적 웹 runtime의 Compose·Nginx 설정·Dockerfile을 소유한다.

- 배포 스크립트가 호스트에서 Vite `dist`를 먼저 생성한다.
- Dockerfile은 프로젝트를 빌드하지 않고 생성된 정적 산출물을 Nginx document root에 복사한다.
- Nginx는 SPA fallback과 `GET /health`를 제공한다.

```bash
npm run deploy -- web
docker compose logs -f web
```

기본 접속 주소는 `http://localhost:5173`이다. API 공개 주소를 바꾸려면 배포 명령을 실행하기 전에
`VITE_API_BASE_URL`을 지정해 로컬 Vite 빌드에 전달해야 한다. 음성 통화용 미디어 게이트웨이
주소도 같은 방식으로 `VITE_MEDIA_GATEWAY_URL`을 지정한다(기본값 `ws://localhost:4000`).
