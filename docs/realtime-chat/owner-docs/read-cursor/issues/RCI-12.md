# RCI-12 Read Cursor 분산 rate limit 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-06](./RCI-06.md)
- [RCI-07](./RCI-07.md)
- [RCI-08](./RCI-08.md)
- [SMI-25 Stream query distributed rate limit](../../stream-messages/issues/SMI-25.md)

### 관련 설계

- [동시성과 멱등성](../design/05-concurrency-and-idempotency.md)
- [입출력과 transport](../design/06-contracts-and-transport.md)

## 작업 정의

**목표**

공통 분산 limiter를 Read Cursor mark와 read-state 경계에 연결해 다중 API/Gateway 인스턴스에서 abuse를
제어한다.

**주요 변경**

- authenticated user와 channel을 포함한 limiter key
- mark와 read-state의 독립 budget
- HTTP/WS 양쪽의 일관된 제한 결과
- Redis 장애 정책, metrics, 운영 설정
- client debounce와 무관한 server-side 보호

**완료 조건**

- 인스턴스가 달라도 같은 principal/key의 budget이 공유된다.
- 다른 사용자의 budget을 공유하지 않는다.
- 제한 전에 DB 쓰기가 발생하지 않는다.
- limiter 장애를 권한 거절이나 `invalid_cursor`로 위장하지 않는다.
- 정확한 임계값은 환경 설정으로 주입되고 부팅 시 검증된다.
- HTTP/WS adapter test와 Redis integration test가 있다.

**비범위**

- global DDoS edge
- client debounce 구현
- Stream Messages limiter 재작성

권장 브랜치 slug: `read-cursor-rate-limit`
