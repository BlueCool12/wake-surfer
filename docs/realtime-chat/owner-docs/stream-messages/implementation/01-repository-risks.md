# Stream Messages 구현 계획: 저장소 선행 위험

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 3. 저장소 기준 선행 위험

### 3.1 Channel 권한 원천 부재

현재 저장소에는 channel 존재 여부와 actor membership을 판정하는 기준 상태가 없다. fake provider로 package
단위 테스트는 할 수 있지만 public endpoint를 공개할 수는 없다. `DEP-CH-01`과 이를 Stream Messages
consumer contract에 연결하는 `SMI-05`는 출시 차단 이슈다. allow-all provider는 허용하지 않는다.

### 3.2 기존 append 저장 불변조건 부족

현재 message append는 다음을 보장하지 않는다.

- text의 UTF-8 8KiB 상한
- 이미 존재하는 `stream_id` row의 target과 새 command에서 계산한 target의 일치
- 기존 DB에 대한 8KiB CHECK constraint upgrade

이 상태에서 조회를 먼저 공개하면 oversized row 또는 target mismatch를 정상 page로 표현할 수 없다.
application append 검증은 `SMI-04`, versioned migration 기반은 `SMI-23`, 기존 row audit과 DB constraint는
`SMI-24`로 분리하고 모두 Query 공개 전에 완료한다.

### 3.3 실제 PostgreSQL 검증 경로 부재

현재 package 테스트는 실제 PostgreSQL의 lock, unique constraint, snapshot, index ordering을 반복 검증하는
공통 경로가 없다. sequence와 page 경계를 mock DB만으로 승인하지 않기 위해 `SMI-03`을 선행한다.

### 3.4 API와 Web의 현재 경계 부족

- API error mapping과 handler timeout fallback은 gateway-ticket 의미에 묶여 있다.
- browser CORS는 현재 `POST`만 허용한다.
- Gateway는 ticket connect까지만 구현되어 message event router가 없다.
- Web `loadHistory()`는 cursor와 snapshot을 표현하지 못하고, history 응답이 live message를 덮어쓸 수 있다.

이 항목들은 각각 API, Gateway, Web 이슈로 분리한다.

### 3.5 인증과 연결 준비 상태 부재

- 현재 public actor header는 실제 인증 edge 없이 평문 값을 신뢰한다.
- 현재 Gateway의 `x-gateway-id`도 식별자일 뿐 service credential이 아니다.
- Web 로그인은 mock이고 realtime-chat ticket/HTTP 요청에 사용할 안정적인 인증 세션이 없다.
- Gateway는 ticket consume과 local session 등록 뒤 `gateway.connected` application event를 보내지 않는다.

public actor session/edge는 `DEP-AUTH-01`, Gateway service credential은 `SMI-20`, 연결 준비 event는
`SMI-21`, Web realtime session bootstrap은 `SMI-22`로 나눈다.
