# Realtime Chat Client

이 문서는 새로운 `@wake-surfer/realtime-chat-client` 패키지를 만드는 이유와 TanStack Query 도입을 검토하는 기준을 기록한다. 아직 구현 방식이나 최종 공개 메서드 시그니처를 확정한 문서는 아니다.

호출부에서 사용할 객체의 제안 계약은 [PUBLIC_INTERFACE.md](./PUBLIC_INTERFACE.md)에 정리했다.

## 1. 왜 새 클라이언트를 만드는가

기존 `realtime-chat-stream-messages-client`는 이름상 메시지 조회와 동기화에 초점이 있지만, 현재는 티켓 발급, WebSocket 연결, 메시지 전송과 수정·삭제, 실시간 수신, 연결 복구까지 다룬다. 웹 앱은 여기에 [런타임 설정](../../apps/web/src/features/chat/transport/browserChatRuntime.ts)과 [세션을 React에 연결하는 코드](../../apps/web/src/features/chat/useChatChannel.ts)를 더해 채팅 화면을 구성한다.

새 패키지는 이 기능들을 호출부에 하나의 채팅 클라이언트로 제공하기 위한 경계다. 웹 앱은 `RealtimeChatClient` 인스턴스를 생성해 채팅 기능을 사용하고, 화면 표현과 앱 수명 관리를 맡는다. 티켓 발급이나 HTTP·WebSocket 조립 순서는 클라이언트 내부에 둔다. 기존 패키지의 코드를 새 패키지로 옮길지, 일부를 내부 의존성으로 유지할지는 구현하면서 결정한다.

## 2. 왜 TanStack Query를 검토하는가

현재 클라이언트는 [변경 구독과 상태 범위](../realtime-chat-stream-messages-client/src/emitter.ts), [사용자·대상별 세션 재사용](../realtime-chat-stream-messages-client/src/realtime-chat-session-registry.ts), [조회 로딩·실패 상태](../realtime-chat-stream-messages-client/src/realtime-chat-session.ts)를 직접 관리한다. 기능이 늘어날수록 서버 데이터의 조회 상태와 캐시 수명을 유지하는 코드도 함께 늘어난다.

TanStack Query를 도입하는 목적은 기존 조회·캐시·요청 상태 관리를 **대체**해 직접 유지할 코드를 줄이는 것이다. 현재 기능이 동작하지 않아서 필요한 변경은 아니다. 메시지 순서와 중복, 누락분 복구, WebSocket 재연결, 전송 멱등성 같은 채팅 고유 규칙은 별도로 남는다.

도입 여부는 구현 후 판단한다. 기존 상태 저장소와 Query 캐시가 같은 메시지를 각각 관리하게 되거나, 상태 동기화 코드가 늘어 전체 복잡도가 줄지 않으면 TanStack Query 적용을 채택하지 않는다.

## 3. 무엇이 달라지는가

| 관점 | 현재 | 목표 |
| --- | --- | --- |
| 웹의 사용 방식 | 런타임과 세션을 조립하고 React 훅으로 구독 | 생성한 채팅 클라이언트 인스턴스의 공개 기능을 사용 |
| 연결 | 호출부가 런타임 설정을 구성 | 클라이언트의 연결 기능이 티켓 발급부터 게이트웨이 접속까지 처리 |
| 메시지 조회 상태 | 클라이언트가 구독·로딩·실패 상태를 직접 관리 | TanStack Query로 해당 책임을 대체할 수 있는지 검증 |
| 실시간 메시지 | 클라이언트 타임라인에 반영 | 채택한 단일 메시지 상태 저장소에 반영하면서 순서·복구 규칙 유지 |
| 전송 결과 | 연결이 끊기면 대기 중인 메시지를 곧바로 `failed`로 표시 | 재연결·확인 중에는 `pending`을 유지하고, 저장 확인·명시적 거절·결과 미확인을 구분 |

전송 결과 확인은 클라이언트 인스턴스의 메모리에 같은 멱등성 키와 내용을 유지하고 API를 통해 DB의 확정 결과를 조회하는 방향을 검토한다. 확인할 수 없는 결과는 실패로 단정하지 않고 `unknown`으로 표시하며 자동 재전송을 중단한다. 이 조회 계약은 아직 구현되지 않았다.

DLQ나 영속 outbox는 도입하지 않는다. 저장되지 않은 메시지를 오래 보관했다가 전송하면 그 시점에 stream 순번이 배정되어 의도한 발화 순서와 대화 맥락이 달라질 수 있기 때문이다. 앱 재진입 시 이전 미확정 전송을 복원해 자동 재전송하지 않는다.
