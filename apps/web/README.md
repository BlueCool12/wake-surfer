# web app

React·Vite 기반 wake-surfer 웹 앱이다.

## Docker 배포

`docker/`가 정적 웹 runtime의 Compose·Nginx 설정·Dockerfile을 소유한다.

- 로컬 `pnpm --filter web build`가 Vite `dist`를 생성한다.
- 배포 스크립트가 정적 산출물을 `docker/artifact/`로 옮긴다.
- Dockerfile은 빌드 없이 Nginx document root에 산출물만 복사한다.
- Nginx는 SPA fallback과 `GET /health`를 제공한다.

```bash
npm run deploy -- web
docker compose logs -f web
```

기본 접속 주소는 `http://localhost:5173`이다. API 공개 주소를 바꾸려면 배포 명령을 실행하기 전에
`VITE_API_BASE_URL`을 지정해 새 정적 bundle을 만들어야 한다.
