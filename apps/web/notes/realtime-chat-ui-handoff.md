# realtime-chat UI 작업 전달서

## 목적

실시간 문자 채팅의 화면과 React 컴포넌트를 설계·구현할 때 필요한 사용자 행동, 상태, 실패 처리만
정리한다. 원본 탐색 문서는 `docs/realtime-chat` 아래에 있지만 저장소 정책상 Git으로 추적하지 않는다.
UI 작업에서는 이 문서를 진입점으로 사용한다.

이 문서는 서버에 없는 기능을 구현됐다고 간주하지 않는다.

- **Current:** 현재 Gateway/API/Web 경로로 동작한다.
- **P:** 프로젝트가 채택한 UI·행동 정책이지만 구현 완료를 뜻하지 않는다.
- **Open:** 구체 동작이나 wire 계약이 아직 결정되지 않았다.

## 구현 범위

| 번호 | 화면·컴포넌트 | 핵심 상태 | 연동 상태 |
| --- | --- | --- | --- |
| 1 | `ChatRoomLayout` | loading, ready, empty, unavailable | Current 확장 |
| 2 | `MessageTimeline` | initial loading, live, recovering, older loading | Current 확장 |
| 3 | `MessageItem` | canonical message, own/other actor | Current 확장 |
| 4 | `MessageComposer` | draft, disabled, submitting | Current 확장 |
| 5 | `MessageStatus` | pending, committed, applied, unknown, retrying, rejected | P |
| 6 | `MessageActionMenu` | edit/delete 권한별 노출 | P, 서버 미구현 |
| 7 | `ReplyPreview` | parent summary, unavailable parent | P, 서버 미구현 |
| 8 | `ThreadPanel` | loading, empty, live, unavailable | P, 서버 미구현 |
| 9 | `ReactionBar` | count, selected, optimistic, rejected | P, 서버 미구현 |
| 10 | `MentionEditor` | 사용자·그룹 mention, invalid target | P, 서버 미구현 |
| 11 | `TypingIndicator` | hidden, active, expired | P, TTL Open |
| 12 | `PresenceIndicator` | latest visible state | P, 상태 집합 Open |
| 13 | `UnreadMarker` | unread 없음, marker, count | P, read cursor 미구현 |
| 14 | `LoadOlderButton` | idle, loading, exhausted, failed | Current |
| 15 | `ConnectionStatusBanner` | connecting, reconnecting, offline, blocked | P, 일부 Current |
| 16 | `MessageRetryAction` | retryable unknown, terminal rejection | P, 일부 Current |
| 17 | `EmptyConversationState` | 메시지 없음 | Current 확장 |
| 18 | `PermissionDeniedState` | view/write/history 제한 | P, 권한 연동 미구현 |
| 19 | `ConversationRecoveryState` | catch-up, full sync required, failed | P, 일부 Current |

서버 transport가 없는 기능은 실제 성공처럼 동작시키지 않는다. presentational component와 명시적
disabled/demo 상태를 만들 수 있지만, 임의의 API나 WebSocket event를 추가하지 않는다.

## 핵심 화면 구조

```text
ChatRoomLayout
├── ConnectionStatusBanner
├── ConversationHeader
│   ├── PresenceIndicator
│   └── ThreadPanel toggle
├── MessageTimeline
│   ├── LoadOlderButton
│   ├── EmptyConversationState
│   ├── UnreadMarker
│   └── MessageItem[]
│       ├── ReplyPreview
│       ├── MessageStatus
│       ├── ReactionBar
│       └── MessageActionMenu
├── TypingIndicator
└── MessageComposer
    ├── MentionEditor
    └── MessageRetryAction
```

## 메시지 상태

현재 Web model의 `pending`, `sent`, `failed` 표시는 유지할 수 있지만 protocol 의미는 다음처럼 구분한다.

| 상태 | UI 의미 | 다른 사용자 전달 의미 |
| --- | --- | --- |
| `DRAFT` | 입력 중 | 없음 |
| `PENDING` | 서버 결과 미확정 | 없음 |
| `COMMITTED` | 저장 또는 기존 멱등 결과 확인 | 전달 완료 아님 |
| `APPLIED` | canonical message를 내 timeline에 반영 | 다른 사용자 수신 보장 아님 |
| `UNKNOWN_COMMIT` | 연결 단절로 저장 여부를 모름 | 알 수 없음 |
| `RETRYING` | 같은 `clientMessageId`로 결과 재확인 중 | 알 수 없음 |
| `REJECTED` | validation·권한·대상 오류로 종료 | commit되지 않음 |

UI의 `전송됨`은 `APPLIED`의 사용자용 표현으로만 사용한다. 모든 수신자에게 전달됐다는 의미로 표시하지
않는다. ACK와 live message는 어느 쪽이 먼저 도착해도 같은 메시지 identity로 하나로 합친다.

## 연결과 Conversation 상태

연결 준비와 개별 Conversation 준비를 분리한다.

```text
Connection
DISCONNECTED
→ CONNECTING
→ AUTHENTICATING
→ READY
→ RECONNECTING
```

```text
Conversation
UNSUBSCRIBED
→ SUBSCRIBING
→ INITIALIZING
→ LIVE
→ RECOVERING
→ FULL_SYNC_REQUIRED
```

- 예상하지 않은 연결 종료는 새 ticket과 새 Gateway session으로 재접속한다.
- 이전 transport session을 복원하는 UI 문구를 사용하지 않는다.
- 새 연결에서 구독을 다시 만들고 delivery cursor 이후를 catch-up한다.
- heartbeat 도입 여부와 UI 표현은 Open이다.
- 한 Conversation의 복구가 다른 Conversation 화면을 모두 초기화하지 않게 한다.

## 주요 사용자 흐름

### Conversation 진입

```text
연결 준비
→ Conversation 구독
→ live message 임시 buffer
→ 최신 이력 조회
→ delivery cursor 기준 gap 조회
→ 중복 제거·sequence 정렬
→ LIVE
```

현재 `chat.channel.join`에는 성공 ACK가 없다. 구독 성공 결과의 구체 wire 이름도 Open이므로, 존재하지
않는 ACK를 프론트에서 가정하지 않는다.

### 메시지 전송

```text
로컬 optimistic item 생성
→ SendMessage
→ Commit ACK 또는 canonical message 수신
→ 같은 identity로 timeline 병합
```

- ACK 전에 연결이 끊기면 실패 확정이 아니라 `UNKNOWN_COMMIT`이다.
- 사용자가 재시도하면 새 메시지를 만들지 않고 같은 `clientMessageId`와 payload를 사용한다.
- 현재 disconnect 시 `failed`로 단순화하는 UI는 `UNKNOWN_COMMIT` 의미를 숨기고 있다.

### 이전 메시지 조회

- `beforeSequence`를 사용하는 history pagination이다.
- delivery cursor와 history cursor는 서로 다르다.
- older 조회의 `invalid_cursor`만으로 Conversation Full Sync를 시작하지 않는다.
- 실패 시 기존 timeline과 live delivery는 유지하고 이전 메시지 로드만 다시 시도한다.

### 읽음 상태

- delivery cursor는 Client가 연속으로 적용한 메시지 위치다.
- read cursor는 사용자가 실제로 읽은 위치다.
- background에서 메시지를 받았다는 이유만으로 read cursor를 전진시키지 않는다.
- read cursor 오류나 다른 device 전달 유실은 delivery Full Sync 사유가 아니다.

## 오류·실패 UI

| 상황 | 사용자 표시 | 허용 행동 |
| --- | --- | --- |
| 연결 전·재연결 중 | 연결 중 또는 재연결 중 banner | 입력 비활성화, 자동 재연결 대기 |
| 메시지 validation 실패 | 입력 내용 오류 | 내용 수정 후 새 시도 |
| 쓰기 권한 없음 | 전송 권한 없음 | 자동 재시도 금지 |
| 대상 대화 접근 불가 | 대화를 사용할 수 없음 | 목록으로 이동 또는 접근 상태 새로고침 |
| ACK 전 연결 단절 | 전송 결과 확인 필요 | 같은 메시지 재시도 |
| 일시적 API 실패 | 잠시 후 다시 시도 | 같은 멱등 key 재시도 |
| delivery cursor 오류 | 메시지 동기화 필요 | 해당 Conversation Full Sync |
| older cursor 오류 | 이전 메시지를 불러오지 못함 | history 경계만 재조회 |
| read cursor 오류 | 읽음 상태를 갱신하지 못함 | 서버 read cursor 재조회 |
| 느린 소비자·과도한 요청 | 연결 또는 전송 지연 | server hint 뒤 재시도 |
| protocol 오류 | 화면 복구 불가 또는 다시 연결 필요 | blind retry 금지 |

오류 상세, token, stack, 내부 URL과 전체 메시지 내용은 사용자 문구에 노출하지 않는다.

## 권한별 UI

| capability | UI |
| --- | --- |
| `conversation:view` | Conversation 화면과 메시지 표시 |
| `conversation:subscribe` | live 상태 진입 |
| `history:read` | 이전 메시지 불러오기 |
| `message:create` | composer 활성화 |
| `message:edit_own` | 내 메시지 수정 메뉴 |
| `message:delete_own` | 내 메시지 삭제 메뉴 |
| `message:delete_any` | Moderator 삭제 메뉴 |
| `reaction:add/remove_own` | reaction 선택·취소 |
| `thread:create/reply` | thread 열기·답글 작성 |
| `mention:user` | 사용자 mention |
| `mention:broadcast` | 그룹 mention |
| `read_cursor:update` | read marker 갱신 |
| `typing:publish` | typing 상태 발행 |

Moderator는 다른 사용자의 메시지를 삭제할 수 있지만 다른 사용자 명의로 수정하지 않는다. view 권한이
회수되면 해당 Conversation 화면·buffer·구독을 제거하고, write 권한만 회수되면 화면은 유지하되
composer와 mutation action을 비활성화한다.

## Multi-device

- 각 browser·device connection의 pending과 delivery recovery는 독립적이다.
- 한 device에서 보낸 메시지는 다른 구독 device에도 같은 canonical identity로 표시한다.
- 한 device의 logout이 다른 device를 자동 종료하지 않는다.
- `LogoutDevice`와 `LogoutAllDevices` UI를 구분한다.
- stable device identity와 logout wire 계약은 Open이다.

## Current와 미구현 경계

### 현재 연결 가능한 UI

- ticket 기반 WebSocket 연결과 `gateway.connected`
- channel join
- text message optimistic 표시, accepted/rejected 결과
- 같은 Gateway 인스턴스의 local message fan-out
- latest·older·sync-after 메시지 조회
- sequence 정렬, 중복 제거와 gap buffer
- connection generation 변경 시 재구독·동기화
- 기본적인 pending·sent·failed 표시

### 서버 연동이 아직 없는 UI

- 메시지 수정·삭제
- 일반 reply와 thread
- reaction
- 구조화 mention
- typing과 presence
- domain read cursor와 unread 동기화
- 실제 membership/capability 판정
- 권한 회수 event 반영
- cross-Gateway durable fan-out
- live gap 자체의 자동 catch-up trigger
- `invalid_cursor` 이후 자동 Full Sync
- 일반 heartbeat·backpressure 정책

## 스타일과 구현 제약

- Tailwind CSS와 UI component library를 새로 도입하지 않는다.
- 컴포넌트 옆에 CSS Module을 둔다.
- 공유 색상·간격은 `src/index.css`의 CSS 변수로 정의한다.
- 내부 정렬은 flex를 우선하고, 페이지 구획이 2차원일 때만 grid를 사용한다.
- 유동 너비와 `max-width`를 기본으로 모바일부터 데스크톱까지 대응한다.
- 범용 아이콘은 `lucide-react`를 사용한다.
- 페이지는 조립만 담당하고 chat 상태와 transport 처리는 `src/features/chat`이 소유한다.

## 작업 완료 확인

- [ ] 위 컴포넌트 목록의 정상·로딩·빈 화면·실패 상태가 구분된다.
- [ ] Commit ACK, local apply, delivery, read 상태를 같은 표시로 합치지 않는다.
- [ ] ACK/live 도착 순서가 바뀌어도 메시지가 중복 표시되지 않는다.
- [ ] reconnect 중 입력과 pending 메시지 처리 방식이 보인다.
- [ ] older, delivery recovery, read cursor UI가 서로 다른 상태로 표현된다.
- [ ] 권한에 따라 composer와 action menu가 올바르게 노출된다.
- [ ] 서버 미구현 기능이 성공하는 것처럼 임의 transport를 만들지 않는다.
- [ ] 모바일과 데스크톱에서 주요 흐름을 사용할 수 있다.
- [ ] 관련 component/model 테스트와 `pnpm --filter web build`가 통과한다.

## 원본 탐색 문서

로컬에서 더 상세한 근거가 필요할 때 다음 파일을 참고한다. 이 파일들은 Git 추적 대상이 아니다.

- `docs/realtime-chat/04-glossary-and-state-machines.md`
- `docs/realtime-chat/06-core-scenarios.md`
- `docs/realtime-chat/07-failure-scenarios.md`
- `docs/realtime-chat/08-command-event-catalog.md`
- `docs/realtime-chat/09-error-policy.md`
- `docs/realtime-chat/10-reconnect-resume-sync-policy.md`
