# web app

React·Vite 기반 wake-surfer 웹 앱이다.

## Docker 배포

`docker/`가 정적 웹 runtime의 Compose·Nginx 설정·Dockerfile을 소유한다.

- 다단계 Dockerfile의 builder stage가 workspace 의존성을 설치하고 Vite `dist`를 생성한다.
- runtime stage는 생성된 정적 산출물을 Nginx document root에 복사한다.
- Nginx는 SPA fallback과 `GET /health`를 제공한다.

```bash
npm run deploy -- web
docker compose logs -f web
```

기본 접속 주소는 `http://localhost:5173`이다. API 공개 주소를 바꾸려면 배포 명령을 실행하기 전에
`VITE_API_BASE_URL`을 지정해 Docker build argument로 전달해야 한다.
