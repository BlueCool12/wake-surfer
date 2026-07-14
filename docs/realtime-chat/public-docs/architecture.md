# realtime-chat 공개 아키텍처

## 책임 경계

- `apps/*`는 환경, 서버, DB/Redis/logger lifecycle과 package mount만 소유한다.
- API package는 권한, 도메인 판단, 저장, transaction, server-side 결과를 소유한다.
- Gateway package는 WebSocket 연결, local session, client event relay를 소유한다.
- 공개 HTTP/WebSocket DTO와 message item은 contracts package가 소유한다.
- 저장 성공과 realtime push 성공은 서로 다른 결과다.

## 통신 흐름

```txt
Client -> Gateway WebSocket -> Gateway internal API client
       -> API HTTP boundary -> Query/Command Handler -> Database
```

Gateway는 API의 내부 구현이나 DB query를 직접 사용하지 않는다. API는 Gateway의 local socket session을 알지 않는다.

## 기능별 문서

- [Stream Messages API](./stream-messages/api.md)
- [Stream Messages invariants](./stream-messages/invariants.md)
- [Stream Messages recovery](./stream-messages/recovery.md)

상세 architecture narrative는 [realtime-chat-architecture.md](../realtime-chat-architecture.md)에 있다.
