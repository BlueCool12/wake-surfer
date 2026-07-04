# @wake-surfer/realtime-chat-contracts 공개 불변 조건

- contract는 외부 wire shape만 설명합니다.
- supported import path는 package root뿐입니다.
- internal command는 이 패키지에서 export하지 않습니다.
- conversation stream, message, read cursor, repository, gateway session 같은 domain model은 이 패키지가 소유하지 않습니다.
- socket event `type` string은 안정적인 consumer-facing protocol입니다.
- `RealtimeChatErrorCode` 이름은 transport/domain boundary에서 공유되는 안정적인 public error name입니다.
- `ISODateTime`은 string contract입니다. producer는 `Date#toISOString()`으로 직렬화해야 합니다.
- ID type alias는 runtime branded value가 아니라 string wire contract입니다.
- gateway ticket request DTO는 ticket TTL 또는 gateway URL override를 포함하지 않습니다.
- `IssueGatewayTicketResponse.gatewayUrl`은 optional입니다.
- message ordering 기준은 `streamId + sequence`입니다.
- message request의 `clientMessageId`는 retry/idempotency 식별에 사용됩니다.
- socket client event의 `commandId`는 request correlation id이며 Gateway가 API DTO의 `requestId`로 전달합니다.
- text user message content는 `{ kind: 'text'; text: string }` shape입니다.
- `OutboundMessageDeliveryRequested.recipientUserIds`는 gateway fan-out 전에 계산됩니다. gateway consumer는 domain recipient를 다시 계산하지 않습니다.
- `OutboundMessageDeliveryRequested.payload`는 client에게 push할 `ChatMessageCreatedEvent`입니다.
