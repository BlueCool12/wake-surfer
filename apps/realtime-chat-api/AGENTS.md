# Realtime Chat API Agent Context

이 app은 Stream Messages provider의 consumer다. provider 내부 구현 문서를 기본 context로 사용하지 않는다.

| Dependency | Need | Read |
| --- | --- | --- |
| `realtime-chat-stream-messages` | 공개 유스케이스와 불변조건 | `packages/realtime-chat-stream-messages/README.md` |
| `realtime-chat-stream-messages-contracts` | HTTP request/response와 직렬화 계약 | `packages/realtime-chat-stream-messages-contracts/README.md` |

Stream Messages HTTP route, actor 인증 연결, final-envelope budget, 오류 mapping과 rate limit은
`src/features/stream-messages`에서 app이 소유한다. provider의 `owner-docs`, `AGENTS.md` 또는 `src/`를
consumer context나 deep import 대상으로 사용하지 않는다.

이 app의 container 계약과 환경 파일은 `docker/`가 소유한다. 프로젝트 빌드와 의존성 설치는
Docker 밖에서 완료하며, Dockerfile은 사전 생성된 로컬 실행 번들만 runtime image에 복사한다.
