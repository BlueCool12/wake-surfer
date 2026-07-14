# SMI-01 공통 공개 message 계약과 stream identity 분리

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- 없음

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [02-slice-and-cursor-model.md](../design/02-slice-and-cursor-model.md)
- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-01. 공통 공개 message 계약과 stream identity 분리

**목표**

`message-send`, stream query, future delivery가 같은 외부 message value와 stream identity를 사용하게 한다.

**주요 변경**

- `packages/realtime-chat-message-contracts` 신규 생성
- `realtime-chat-message-send-contracts`의 공통 ID, target, `PublicMessage`, text content를 새 owner로 이동
- Web의 임시 message DTO를 즉시 제거하지는 않되 migration 대상임을 명시
- target에서 canonical stream ID를 계산하는 공통 순수 함수 제공

**확정 구현 규칙**

- canonical 외부 필드명은 현재 서버 계약의 `senderActorId`, `target`, `content.type = text`를 유지한다.
- 첫 version은 `USER/TEXT`만 표현하고 `SYSTEM` 또는 알 수 없는 variant를 parse하지 않는다.
- history message item에는 `clientMessageId`를 넣지 않는다.
- text byte 계산은 UTF-8 기준이며 JavaScript string length를 사용하지 않는다.
- canonical stream ID는 `{targetType}:{targetId}`다. channel은 `channel:{channelId}`다.
- send와 query는 같은 exported helper를 사용하고 각자 resolver 규칙을 복제하지 않는다.

**완료 조건**

- strict runtime schema와 타입이 함께 제공된다.
- 8,192 byte text는 허용하고 8,193 byte text는 거절하는 다국어/emoji 경계 테스트가 있다.
- message-send contracts가 공통 정의를 중복하지 않는다.
- 기존 message-send consumer build와 테스트가 통과한다.
- package README가 공개 계약과 비공개 내부 모델을 구분한다.

**비범위**

- `SYSTEM` message 도입
- send HTTP/WS adapter

권장 브랜치 slug: `public-message-contract`

---
