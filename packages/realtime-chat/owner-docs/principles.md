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
- usecase는 HTTP DTO와 전체 runtime deps를 그대로 처리하지 않고 package-private command와 좁은 dependency로 business flow를 조율합니다.
- ticket 발급처럼 계산 규칙, 포트 호출, 저장 record 변환이 섞이는 흐름은 불변 domain data와 이름 있는 domain function/service로 분리합니다.
- 필수 permission, gateway assignment, DB 같은 조립 계약 누락은 usecase fallback으로 숨기지 않고 composition 단계에서 드러나게 합니다.
