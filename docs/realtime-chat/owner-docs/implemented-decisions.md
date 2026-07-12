# realtime-chat 구현 확정사항

## 문서 목적

이 문서는 초기 스케치가 아니라 현재 `dev`의 코드, 테스트, 기능 패키지 README에서 확인되는 결정만
기록한다. 후보 설계나 아직 구현되지 않은 흐름은 확정사항으로 승격하지 않는다.

기능별 외부 계약의 원본은 각 contracts 패키지다. 이 문서는 여러 기능에 걸친 현재 내부 경계와
일관성 결정을 설명한다.

## 기능과 데이터베이스의 소유 경계

- `@wake-surfer/realtime-chat-database`는 PostgreSQL 연결 풀, Kysely 인스턴스, 전체 DB 타입 합성과
  공통 마이그레이션 진입점을 소유한다.
- 기능별 테이블 계약과 SQL 쿼리는 해당 기능 패키지가 소유한다.
- 기능 패키지는 공통 데이터베이스 패키지에 의존하지 않고 주입받은 Kysely DB 핸들을 사용한다.
- 앱은 데이터베이스 생명주기와 필요한 기능 모듈을 조립하되 기능 내부 SQL을 소유하지 않는다.

## 게이트웨이 티켓

현재 구현 패키지는 `@wake-surfer/realtime-chat-gateway-ticket`이다.

확정된 규칙은 다음과 같다.

- 티켓은 인증된 `actorId`에 대해 발급한다. `actorId`는 클라이언트 요청 본문이 아니라 인증된 서버
  문맥에서 가져온다.
- 티켓 원문은 발급 응답으로만 반환하고 PostgreSQL에는 해시만 저장한다.
- 저장 행은 `actor_id`, `assigned_gateway_id`, `issued_at`, `expires_at`, `consumed_at`을 가진다.
- 소비 요청 본문은 티켓 원문만 받는다. `gatewayId`는 신뢰 가능한 서버 문맥에서 주입한다.
- 소비는 티켓 해시와 할당된 Gateway가 일치하고, 아직 소비되지 않았으며, 만료되지 않은 행 하나를
  단일 `UPDATE ... RETURNING` 문으로 갱신한다.
- 따라서 같은 티켓의 동시 소비는 한 번만 성공한다.
- 티켓 부재, 만료, 재사용, Gateway 불일치는 외부에서 모두 `invalid_or_expired`로 보인다.

공유 PostgreSQL이 티켓 소비 상태의 기준 저장소라는 점은 확정됐다. 다만 WebSocket Gateway가
PostgreSQL에 직접 접근한다는 흐름은 현재 공개 계약으로 확정하지 않는다. 호출 경계는 티켓 기능의
공개 모듈과 contracts 패키지를 통해 조립한다.

## 메시지 전송

현재 구현 패키지는 `@wake-surfer/realtime-chat-message-send`다.

확정된 규칙은 다음과 같다.

- 외부 입력의 target은 `channel`, `dm`, `thread` 중 하나다.
- 서버는 target을 `streamId`와 수신자 `actorId` 목록으로 해석한 뒤 쓰기 권한 경계를 호출한다.
- 현재 메시지 content는 비어 있지 않은 text만 허용한다.
- 메시지 정렬 순번은 전역 값이 아니라 stream별 `sequence`다.
- 메시지 저장 트랜잭션은 stream 행을 잠그고 `last_sequence`를 증가시킨 뒤 메시지를 저장한다.
- `(stream_id, sequence)`는 고유해야 한다.
- `(sender_actor_id, stream_id, client_message_id)`는 고유해야 한다.
- 같은 `clientMessageId` 재시도는 기존 메시지와 sequence를 반환하고 새 메시지를 저장하지 않는다.
- 중복 요청에서는 outbound delivery 요청을 다시 발행하지 않는다.
- 저장된 메시지에 대한 delivery 요청 발행은 최선형으로 처리한다. 발행 실패는 저장 결과를
  되돌리거나 accepted 결과를 rejected로 바꾸지 않는다.
- 따라서 `accepted`는 메시지 저장 확정이지 수신자 소켓 전달 완료가 아니다.

## 아직 확정사항으로 승격하지 않는 내용

다음 내용은 초기 스케치에 존재하지만 현재 `dev`의 구현 계약으로 확인되지 않았다.

- WebSocket 세션 레지스트리와 여러 Gateway 사이의 fan-out 방식
- Redis, Kafka, NATS 또는 인메모리 버스 중 실제 outbound adapter 선택
- Gateway와 API 사이의 최종 HTTP endpoint와 오류 매핑
- 송신자를 delivery 수신자 목록에 포함할지에 대한 정책
- `afterSequence` 기반 누락 메시지 동기화
- Read Cursor와 unread projection
- Presence 상태와 다중 세션 정책
- 협업 세션 이벤트에 따른 시스템 메시지
- DM과 thread의 세부 권한 및 참여자 정책

이 항목은 구현과 테스트가 추가되거나 별도 결정이 승인될 때 해당 기능 소유 문서로 승격한다.

## 공개 계약 경로

소비자는 중앙의 이벤트 스토밍 기록이 아니라 필요한 기능의 공개 문서를 읽는다.

- `packages/realtime-chat-gateway-ticket/README.md`
- `packages/realtime-chat-gateway-ticket-contracts/README.md`
- `packages/realtime-chat-message-send/README.md`
- `packages/realtime-chat-message-send-contracts/README.md`
- `packages/realtime-chat-database/README.md`

`docs/realtime-chat/notes/`는 현재 계약이나 에이전트 문맥 경로로 사용하지 않는다.
