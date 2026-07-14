# Stream Messages 설계: Target 범위와 stream selector

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 10. Channel, DM, Thread 적용

세 Query의 pagination과 ordering은 stream type과 무관하게 동일하게 적용할 수 있다. 달라지는 것은 stream
resolve와 read authorization이다. 다만 MVP 공개 범위는 channel 하나이며, DM과 thread row는 첫 구현에
포함하지 않는다.

| Target | MVP 공개 여부 | 읽기 전 확인 | 빈 stream 처리 | 추가 규칙 |
| --- | --- | --- | --- | --- |
| Channel | 공개 | workspace/channel read membership | 읽을 수 있으면 빈 message page | 현재 권한이 있으면 저장된 전체 history 조회 |
| DM | 비공개 | 후속 범위에서 결정 | MVP 계약 없음 | 첫 구현에서 제외 |
| Thread | 비공개 | 후속 범위에서 root의 parent stream read 권한 확인 | 빈 thread를 표현하지 않음 | 첫 reply로 thread가 생성된 뒤에만 조회 |

thread reply 본문은 channel stream query에 섞지 않는다. channel timeline이 root message의
`threadSummary`를 포함하지 않는다. 향후 thread 조회를 공개하더라도 reply 본문은 별도 thread stream에서만
조회한다.

현재 실제 channel read permission provider는 구현되어 있지 않다. production runtime에 allow-all 기본값을
두지 않는다. channel authorizer가 준비되지 않으면 앱 조립을 실패시키거나 Query를 공개하지 않아야 한다.

첫 channel 권한 모델은 public channel의 active workspace member와 private channel의 active channel member를
허용한다. archived channel도 해당 membership을 유지한 actor에게 read-only history 조회를 허용한다.
channel 존재, visibility, membership의 기준 상태는 channel bounded context가 소유하고 Stream Messages는
그 provider를 좁은 `ChannelReadAuthorizer`로 소비한다.

Thread는 첫 reply가 저장될 때 생성된다. 따라서 root message만 있고 reply가 없는 상태는 thread로
표현하지 않으며, `rootMessageId`로 빈 reply page를 조회하는 계약도 제공하지 않는다. 향후 thread Query를
공개할 때는 이미 생성된 canonical thread target만 selector로 받을 수 있다. stream messages Query는 reply
page만 반환하고 root message와 thread metadata 조회는 별도 Query라는 경계를 유지한다.

## 11. Stream selector와 빈 stream 문제

Query selector를 확정할 때 가장 중요하게 다룬 문제다.

현재 flow 제안은 client가 opaque `streamId`로 sync하는 그림을 사용한다. 그러나 현재 DB는 첫 message 때
stream row를 lazy create한다. message가 한 건도 없는 target은 stream row가 없으므로 `streamId`만으로는
target 존재와 읽기 권한을 확인할 정보가 없다.

가능한 선택은 다음과 같다.

### 선택 A — 모든 Query가 target selector를 받는다 — **채택**

- channelId, dmConversationId, threadId 중 하나를 받는다.
- server가 target을 canonical stream으로 resolve하고 권한을 확인한다.
- 읽기 Query가 stream row를 만들지 않아도 빈 성공을 표현할 수 있다.
- response는 canonical `streamId`를 돌려준다.

### 선택 B — stream을 target 생성 시 eager create한다

- 모든 Query가 opaque `streamId`만 받을 수 있다.
- channel/DM/thread 생성 lifecycle과 stream 생성 transaction을 새로 묶어야 한다.
- 현재 lazy append 구조를 바꾸는 선행 작업이 필요하다.

### 선택 C — `streamId`와 target hint를 함께 받는다

- 서버가 둘의 일치를 검증해야 한다.
- 계약과 오류가 복잡해지고 client가 두 식별자를 함께 보존해야 한다.

선택 A를 채택한다. MVP의 세 Query는 `channelId`를 받고 server가 canonical stream을 resolve하며, 조회는
stream row를 생성하지 않는다. response는 canonical `streamId`를 반환한다. thread에는 향후 공개 시
`SM-22`의 “첫 reply 이후에만 조회” 규칙이 우선 적용된다.

canonical stream identity는 공통 message contract가 소유한다. 첫 버전의 결정적 규칙은
`{targetType}:{targetId}`이며 channel은 `channel:{channelId}`다. message-send와 stream-messages는 각각
resolver를 만들지 않고 같은 공통 함수를 사용한다. 따라서 빈 channel 조회에서 계산해 반환한 `streamId`와
첫 message append가 생성하는 `streamId`가 반드시 같다. 이미 존재하는 stream row의 target과 계산한
identity가 다르면 정상 빈 결과로 처리하지 않고 data-integrity failure로 중단한다.
