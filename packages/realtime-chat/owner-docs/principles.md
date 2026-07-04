# @wake-surfer/realtime-chat 원칙

- `realtime-chat`은 하나의 feature입니다. API/Gateway는 별도 package가 아니라 같은 feature의 adapter 경계입니다.
- app은 얇게 유지합니다. mount와 deps만 받고 feature behavior는 내부에 둡니다.
- command는 package-private으로 유지합니다.
- public response/event shape는 contracts package DTO와 맞춥니다.
- Gateway는 transport shape와 supported event type만 검증합니다.
- 최종 chat permission과 persistence는 API side에 둡니다.
- socket event는 public API DTO로 mapping하며 API private command로 mapping하지 않습니다.
- outbound delivery는 save 이후 best effort로 publish하고, gateway는 local session에만 push합니다.
- API/Gateway 사이 중복이 실제로 커지기 전까지 generic ws-runtime package를 만들지 않습니다.
