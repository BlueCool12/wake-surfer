# @wake-surfer/realtime-chat 공개 불변 조건

- app은 mount option과 runtime dependency만 결정합니다.
- app은 command, handler, usecase, repository, domain model, socket event router를 직접 만들지 않습니다.
- API side는 message permission check, idempotency lookup, append, ACK response, best-effort outbound publish를 소유합니다.
- Gateway side는 ticket consume, local session registry, socket payload validation, API DTO forwarding, ACK relay, outbound fan-out을 소유합니다.
- Gateway side는 최종 chat permission decision이나 message persistence를 수행하지 않습니다.
- message ordering 기준은 `streamId + sequence`입니다.
- user message idempotency key semantics는 sender, target, `clientMessageId`로 retry를 식별합니다.
- outbound publish failure는 저장된 message를 rollback하지 않습니다.
- read cursor update는 cursor를 뒤로 이동시키지 않습니다.
- public wire DTO는 `@wake-surfer/realtime-chat-contracts`에서 가져옵니다. package-private command는 이 패키지 내부에 둡니다.
