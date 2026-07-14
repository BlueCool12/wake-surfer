# Stream Messages 설계: 권한, 계약, transport

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 14. 권한, 오류, 정보 은닉

### 14.1 권한

- actor identity는 API auth context 또는 Gateway session에서 주입한다.
- client body의 actor ID를 신뢰하지 않는다.
- read authorization은 message row/content 조회 전에 실행한다.
- multi-page query는 page마다 현재 권한을 다시 확인한다.
- Gateway는 local session만 확인하고 channel/DM/thread membership을 추측하지 않는다.
- 권한 provider가 없는 production 조립에 allow-all fallback을 두지 않는다.

과거 가시 범위에는 별도의 하한을 두지 않는다. 현재 target read authorization을 통과한 actor는 저장된
전체 history를 조회할 수 있고, authorizer는 `minimumReadableSequence`를 반환하지 않는다. 각 page에서
현재 권한을 다시 확인하는 원칙은 유지한다. MVP에서는 channel에 적용하며, 향후 DM을 공개하더라도
재참여로 현재 읽기 권한을 다시 얻으면 재참여 이전의 저장 history까지 조회할 수 있다는 의미다.

첫 버전은 page 시작 시 authorization을 완료한 뒤 message query를 실행하며, 그 사이에 membership이
철회되는 짧은 race를 허용한다. 서로 다른 권한 원천과 message DB를 하나의 transaction으로 묶지 않는다.
다음 page에서는 다시 authorization하므로 철회 이후의 추가 조회는 중단된다. 더 강한 즉시 철회 보장이
필요해지면 권한 원천의 snapshot/version 계약을 별도 확장한다.

### 14.2 도메인 결과와 infrastructure failure

다음은 domain/query rejection이다.

- 읽을 수 없거나 존재하지 않는 target/stream
- cursor가 현재 head보다 큼
- 잘못된 page cursor 또는 watermark

다음은 정상 rejected result로 위장하면 안 된다.

- DB timeout/failure
- Gateway → API network failure
- API 5xx
- response schema mismatch
- current no-retention invariant에서 발견한 sequence gap

존재하지 않는 private stream과 권한이 없는 stream을 다른 reason으로 노출하면 resource enumeration이 가능할
수 있다. 외부 reason은 하나의 `stream_unavailable`로 합친다.

입력과 watermark validation의 확정 기준은 다음과 같다.

- sequence와 limit는 JSON number 중 safe integer만 허용한다.
- `afterSequence`와 `throughSequence`는 0 이상이어야 한다.
- `beforeSequence`는 1 이상이어야 한다.
- 후속 sync는 `afterSequence <= throughSequence <= current headSequence`여야 한다.
- explicit `throughSequence`는 secret이나 권한 token이 아니다. 서버가 범위를 매 page 검증한다.
- malformed/unsafe number는 transport `bad_request`, 유효한 숫자지만 stream 상태와 맞지 않는 cursor는
  domain `invalid_cursor`로 구분한다.
- after/older limit 미지정은 50을 사용하고 100 초과는 clamp하지 않고 거절한다.
- request object는 strict schema로 검증하고 client-owned actor, 권한, server watermark 외의 unknown field를
  거절한다.

첫 버전은 client-visible numeric `throughSequence`를 사용한다. 서버는 매 page에서 값의 범위를 검증하지만
“첫 page에서 실제로 발급한 값과 같은가”까지 stateless하게 증명하지 않는다. 이 증명이 필요해지면
watermark와 selector를 담은 signed/opaque continuation token 또는 server-side sync state를 별도 도입한다.

현재 schema에는 retention과 hard delete가 없다. 따라서 요청 범위 안의 sequence gap은 정상 history
상태가 아니라 infrastructure/data-integrity failure다. retention은 이번 범위에서 제외하며, 미래에 도입할
때 `earliestAvailableSequence`와 reset-required cursor 의미를 별도 결정한다.

## 15. Contract와 package 소유권

현재 저장소 구조에 맞춘 확정 책임은 다음과 같다.

```txt
packages/realtime-chat-message-contracts
  versioned PublicMessage item schema
  USER/TEXT content schema
  UTF-8 text 8KiB invariant
  canonical target -> streamId identity rule

packages/realtime-chat-stream-messages-contracts
  load-latest 전용 request/response schema
  sync-after 전용 request/response schema
  load-older 전용 request/response schema
  공개 query rejection code
  response 48KiB invariant
  boundary별 canonical JSON serializer / UTF-8 byte measurer

packages/realtime-chat-stream-messages
  usecases/load-latest-stream-messages
  usecases/sync-stream-messages-after-sequence
  usecases/load-older-stream-messages
  slice-local Kysely query / mapper / policy
  ChannelReadAuthorizer consumer contract와 target resolver 경계
  API public/internal route registration과 transport mapping
  Gateway sync event router와 API client mapping
```

구체 package/file 작업은 이 결정문을 기준으로 별도 구현 계획에서 이슈 단위로 나눈다. 위 구조의 핵심은
capability package 하나에 세 Handler를 두되 하나의 다중-mode Handler로 합치지 않는 것이다.

저장소 의존 방향은 다음과 같다.

- stream messages provider는 현재 message tables의 공개 table contract를 read-only로 사용한다.
- `send-message.kysely.ts`의 private row parser를 deep import하지 않는다.
- 새 table은 만들지 않는다.
- Query package가 `realtime-chat-database` 전체 runtime package를 참조하지 않는다.
- 공통 message row/public item mapping이 실제로 두 capability에서 필요하면 명시적 owner package로
  승격한다.

Query request/response envelope은 서로 공유하지 않는다. `PublicMessage`처럼 send response, delivery event,
stream query에서 같은 외부 value를 뜻하는 message item은 send-specific contracts에서 분리해
`@wake-surfer/realtime-chat-message-contracts`가 소유한다. message-send contracts는 이 공통 계약을
재사용한다.

HTTP route와 WebSocket event mapping은 app에 직접 구현하지 않고 stream-messages package가 소유한다.
API/Gateway app은 server, 인증 문맥, DB, HTTP client 같은 runtime resource를 만들고 package의
register/mount entrypoint를 호출한다. app이 Query DTO, pagination, 오류 mapping을 다시 구현하지 않는다.

`ChannelReadAuthorizer`의 좁은 consumer-side contract는 stream messages provider가 소유한다. 현재
저장소에는 channel 존재와 membership을 판정할 concrete provider가 없으므로 이를 제공하는 선행 이슈가
필요하다. concrete 권한 규칙을 app shell이나 allow-all fallback으로 대신하지 않으며, provider가 준비되기
전에는 public Query adapter를 mount하지 않는다.

첫 공개 계약의 message variant는 현재 저장 가능한 `USER/TEXT` 하나로 제한한다. `SYSTEM` message는
지원하지 않으며, 이를 알 수 없는 variant로 묵시 변환하지도 않는다. SYSTEM을 도입하려면 storage와 공개
contract를 함께 확장하는 별도 결정을 거친다.

## 16. Transport 경계

세 Query Handler는 transport-neutral하게 유지한다. 첫 공개 adapter는 다음과 같다.

- HTTP latest/older query
- WebSocket after recovery `chat.stream.sync` → `chat.stream.synced` relay
- HTTP 기반 Gateway → API internal query

Gateway가 WebSocket query를 relay하더라도 read authorization과 pagination 의미는 API/provider가 소유한다.
Gateway는 actor를 session에서 주입하고 request/result correlation, payload limit, timeout/cancellation만
담당한다.

Gateway가 전달하는 actor identity의 신뢰 경계는 공개 internal contract에 포함한다. browser가 body나
header로 보낸 actor ID를 그대로 전달해서는 안 된다. 현재 `x-gateway-id` 평문 값은 식별자일 뿐 production
자격 증명으로 사용하지 않는다. MVP internal route는 TLS 위에서 별도 Gateway service bearer credential을
검증하고, 인증에 성공한 경우에만 server-only actor header를 읽는다. actor는 request body에 넣지 않으며
public route에서는 asserted actor header를 읽지 않는다. public actor도 인증 세션 또는 신뢰된 edge가
주입해야 하며 현재의 평문 actor header adapter는 명시적인 개발·테스트 환경에서만 허용한다.

latest/older는 HTTP로 제공하고 after recovery는 WebSocket으로 relay한다. Gateway → API 내부 호출이
필요하더라도 같은 Handler와 Query 의미를 사용하며 별도 pagination 규칙을 만들지 않는다.

Query correlation 이름은 `requestId`를 사용한다. domain idempotency key가 아니라 응답 relay와 stale
response 폐기에 쓰이는 transport correlation이기 때문이다.
