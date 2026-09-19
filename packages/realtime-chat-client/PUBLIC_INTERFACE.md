# RealtimeChatClient 공개 인터페이스 초안

이 문서는 웹 앱이 사용할 객체의 **제안 계약**이다. 구현 코드는 아직 없다. 아래 시그니처로 호출부의 기대 동작을 먼저 작성한 뒤, BDD 시나리오에서 불필요하거나 모호한 부분을 조정한다.

## 호출부의 사용 모습

웹 앱은 인증된 사용자에게 `RealtimeChatClient` 인스턴스를 하나 만들고, 채팅 화면에서는 그 인스턴스를 사용한다. 클라이언트 하나가 하나의 실시간 연결과 여러 채널·스레드를 관리한다. 별도의 패키지 전용 Provider나 `useChatRoom`을 공개 계약으로 요구하지 않는다. 웹 앱의 React 코드는 클라이언트가 제공하는 상태 구독을 화면 렌더링에 연결한다.

```ts
import { RealtimeChatClient } from "@wake-surfer/realtime-chat-client";

const target = { type: "channel", channelId } as const;
const client = new RealtimeChatClient({ apiBaseUrl, actorId, targets: [target] });

const stopObserving = client.subscribeMessagesForTarget(target, () => {
  render(client.getMessagesByTarget(target));
});

await client.connect();
await client.loadLatestMessagesForTarget(target);

const outgoing = client.sendMessageForTarget(target, { text: "안녕하세요" });
// outgoing은 즉시 생성된다. 서버 확인 전 상태는 pending이다.

await client.loadOlderMessagesForTarget(target);

stopObserving();
client.disconnect();
client.dispose();
```

`render`는 사용 모습을 보여 주기 위한 자리표시자다. 실제 웹 앱에서는 React의 구독 API로 연결한다. `connect()`는 WebSocket 연결을 준비하지만, 메시지 조회는 HTTP로 수행하므로 조회 자체가 WebSocket 연결에 종속되지는 않는다.

## 제안 시그니처

```ts
type ChatTarget =
  | { type: "channel"; channelId: string }
  | { type: "thread"; threadId: string };

type SendMessageRejectedReason =
  | "invalid_text"
  | "target_not_found"
  | "write_forbidden"
  | "idempotency_conflict"
  | "message_deleted";

interface RealtimeChatClientOptions {
  apiBaseUrl: string | URL;
  actorId: string;
  targets: readonly ChatTarget[];
}

interface RealtimeChatClientError extends Error {
  readonly code: string;
}

type ConnectionState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; connectionGeneration: string }
  | { status: "failed"; error: RealtimeChatClientError };

type SendStatus =
  | { status: "pending" }
  | { status: "sent"; messageId: string }
  | { status: "failed"; reason: SendMessageRejectedReason }
  | { status: "unknown"; reason: "confirmation_unavailable" };

interface ChatMessage {
  readonly key: string;
  readonly messageId?: string;
  readonly content: { type: "text"; text: string } | null;
  readonly status: SendStatus;
  readonly createdAt: string;
}

interface OutgoingMessage {
  readonly key: string;
  readonly status: SendStatus;
  subscribe(onChange: () => void): () => void;
  canRetry(): boolean;
  retry(): void;
}

interface MessagesResult {
  readonly messages: readonly ChatMessage[];
  readonly isLoadingLatest: boolean;
  readonly isLoadingOlder: boolean;
  readonly hasMoreBefore: boolean;
  readonly error?: RealtimeChatClientError;
}

declare class RealtimeChatClient {
  constructor(options: RealtimeChatClientOptions);

  readonly connectionState: ConnectionState;
  subscribeConnection(listener: () => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
  dispose(): void;

  addTarget(target: ChatTarget): void;
  removeTarget(target: ChatTarget): void;

  sendMessageForTarget(target: ChatTarget, input: { text: string }): OutgoingMessage;
  loadLatestMessagesForTarget(target: ChatTarget): Promise<void>;
  loadOlderMessagesForTarget(target: ChatTarget): Promise<void>;
  getMessagesByTarget(target: ChatTarget): MessagesResult;
  subscribeMessagesForTarget(target: ChatTarget, listener: () => void): () => void;
}
```

`RealtimeChatClientOptions`에는 API 주소, 사용자별 상태를 구분할 정보, 처음 다룰 대상 목록인 `targets`가 필요하다. 대상 목록은 빈 배열로 시작할 수 있다. 인증된 요청을 만드는 방식은 호출부 코드를 작성하면서 결정한다. `actorId`는 상태 구분 값이며, 서버 인증을 대신하지 않는다. 현재 클라이언트가 지원하는 대상은 채널과 스레드다.

`OutgoingMessage.key`는 메시지 목록의 같은 임시 항목을 가리키는 안정적인 키다. 서버가 수락한 뒤에도 호출부가 같은 메시지를 추적할 수 있어야 한다. `getMessagesByTarget()`과 `connectionState`는 변화가 없을 때 같은 참조를 돌려주어 React 구독에 사용할 수 있게 한다.

## 각 기능의 의미

### 연결

`connect()`는 내부에서 게이트웨이 티켓을 발급받고 WebSocket을 열어 연결 완료를 확인한다. 호출부는 티켓을 받거나 갱신하지 않는다. 연결 실패는 구분 가능한 오류로 전달하고, 웹은 `connectionState`로 상태를 표시하거나 `connect()`를 다시 호출한다. `disconnect()`는 연결을 의도적으로 끊고, `dispose()`는 클라이언트의 구독과 메모리 상태를 정리한다. 연결 중 네트워크가 끊길 수 있으므로 타입을 연결 전후로 바꾸지 않는다.

### 대상 등록과 호출 전제

생성자의 `targets`는 클라이언트가 다룰 초기 범위다. `addTarget()`과 `removeTarget()`으로 실행 중 그 범위를 변경한다. 대상은 객체 참조가 아닌 `type`과 해당 식별자로 구분한다. 등록은 서버 접근 권한을 부여하지 않으며, 인증과 대상별 접근 권한은 서버에서 별도로 검증한다.

조회·구독·전송 메서드에 전달하는 `target`은 등록된 범위에서 작업할 대상을 선택한다. 해당 메서드가 대상을 암묵적으로 추가하지 않는다. 현재 결과를 읽는 메서드는 `getMessagesByTarget()`, 조회 요청·구독·전송 동작은 `loadLatestMessagesForTarget()`, `loadOlderMessagesForTarget()`, `subscribeMessagesForTarget()`, `sendMessageForTarget()`으로 이름을 구분한다.

미등록 대상을 전달하면 `code`가 `target_not_registered`인 `RealtimeChatClientError`를 호출 시 동기적으로 `throw`한다. 이 경우 요청·리스너 등록·전송 큐 추가는 수행하지 않는다. `undefined`, 오류 결과 객체, 빈 메시지 목록으로 대신 반환하지 않는다. `Promise`를 반환하는 조회 요청 메서드도 대상 검증은 Promise를 반환하기 전에 수행한다. 대상 검증을 통과한 뒤 발생하는 비동기 조회 실패는 Promise 거절과 조회 오류 상태로 전달한다.

등록된 대상에 메시지가 없으면 `getMessagesByTarget()`은 `messages: []`를 포함하는 `MessagesResult`를 반환한다. 이 결과 자체는 nullable하지 않다. 기존 `MessagesSnapshot` 타입 이름은 이 초안에서 `MessagesResult`로 표기한다.

대상 등록은 수신할 범위를 관리하고, `subscribeMessagesForTarget()`은 그 대상의 메시지 결과 변경을 관찰하는 리스너를 등록한다. 반환된 함수는 해당 리스너를 해제하며 대상을 제거하지 않는다. 대상 제거 시 기존 리스너·캐시·대기 중 전송을 어떻게 정리할지는 후속 호출부에서 정한다.

### 메시지 전송

`sendMessageForTarget()`는 한 논리적 메시지에 멱등성 키를 한 번 발급하고, `pending` 메시지를 즉시 반환한다. 전송 결과는 반환된 메시지의 상태와 메시지 목록에 반영한다. 호출부가 서버 응답을 `await`할 필요는 없다.

대상별 메모리 전송 큐를 두고 같은 대상의 메시지는 순서대로 전송한다. 앞선 메시지의 결과를 기다리는 동안 다음 메시지도 `pending`으로 표시한다. 앞선 전송이 `unknown`이 되었을 때 뒤의 대기 메시지를 처리하는 정책은 아직 정하지 않았다.

일시적인 연결 끊김이나 서버 장애에는 내부 재연결·재시도를 수행하며 `pending`을 유지한다. 재시도에는 같은 멱등성 키와 같은 내용을 사용한다. `sent`는 서버의 저장 확정 응답이나 API의 DB 확인 결과가 있을 때, `failed`는 명시적인 거절 등 저장되지 않았다는 확정 결과가 있을 때만 사용한다. 확인 절차를 마쳐도 저장 여부를 알 수 없으면 `unknown`으로 표시하고 자동 재전송을 중단한다. 멱등성 키와 내용은 클라이언트 인스턴스의 메모리에만 유지한다. `retry()`가 허용되는 경우 이 기록을 사용해 같은 논리적 메시지의 처리를 이어간다.

DLQ나 영속 outbox는 도입하지 않는다. 미확정 전송 기록은 `dispose()`나 페이지 종료 시 정리되며, 앱 재진입 시 복원하거나 자동 재전송하지 않는다. 저장되지 않은 메시지가 뒤늦게 전송되면 그 시점에 stream 순번이 배정되므로 원래 의도한 발화 순서를 보장할 수 없다. 이미 저장된 메시지는 같은 키로 재시도해도 기존 순번을 유지한다.

API의 멱등성 키별 결과 확인 계약은 후속 작업이다. 현재 서버에는 웹에서 호출할 수 있는 결과 조회 API가 없다. DB 조회 결과가 단순히 `없음`인 것만으로는 이전 요청이 아직 처리 중일 수 있으므로 `failed`로 단정하지 않는다. 로컬 기록을 정리하는 것은 서버 요청의 취소가 아니므로, 이미 저장됐거나 처리 중이던 메시지는 이후 조회·동기화에서 나타날 수 있다.

### 조회와 실시간 수신

`loadLatestMessagesForTarget()`와 `loadOlderMessagesForTarget()`는 HTTP 조회를 실행하고, 결과를 해당 대상의 메시지 상태에 반영한다. 이전 페이지의 커서는 클라이언트가 관리한다. `getMessagesByTarget()`은 조회한 메시지와 전송 중인 메시지, 로딩·오류 상태를 함께 제공한다.

`subscribeMessagesForTarget()`으로 등록한 리스너는 해당 대상의 `MessagesResult`가 바뀔 때 호출된다. WebSocket으로 푸시된 메시지는 클라이언트가 검증하고 순서·중복·누락분 복구를 처리한 뒤 같은 메시지 결과에 반영한다. 채널 구독과 재연결 후 재가입도 클라이언트가 처리한다. 호출부는 원시 WebSocket 프레임과 HTTP 결과를 직접 합치지 않는다. 반환된 함수로 구독을 해제한다.

TanStack Query를 채택하면 조회·캐시·요청 상태를 이 인터페이스 **내부**에서 구현한다. 웹 앱의 공개 호출 방식이 TanStack Query의 훅이나 `QueryClient`에 종속되지는 않는다. 기존 상태 관리와 병행해 중복 저장소를 만들지 않으며, 실제 구현에서 복잡도가 줄지 않으면 기존 방식을 유지한다.

## BDD에서 확인할 동작

- 연결 시 티켓 발급과 게이트웨이 접속이 호출부에 노출되지 않는다.
- 전송 직후 메시지가 보이고, 일시적인 연결 끊김에는 `pending`이 유지된다.
- 같은 메시지를 재시도할 때 멱등성 키와 내용이 유지된다.
- DB 저장 확인, 명시적 거절, 확인 불가가 각각 `sent`, `failed`, `unknown`으로 관측된다.
- `unknown` 전환 후 자동 재전송을 중단하며, 앱 재진입 시 이전 미확정 전송을 복원하거나 자동 재전송하지 않는다.
- 최신·이전 메시지와 WebSocket 푸시가 하나의 순서 있는 목록으로 관측된다.
- 사용자 변경이나 인스턴스 정리 시 이전 사용자의 구독과 상태가 남지 않는다.

메시지 수정·삭제는 현재 클라이언트에 이미 있는 기능이므로 새 공개 계약에서도 유지해야 한다. 결과 상태와 재시도 규칙은 해당 호출부 시나리오를 작성하면서 시그니처를 확정한다.
