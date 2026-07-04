# @wake-surfer/realtime-chat-contracts 연동

consumer는 보통 feature package를 통해 이 패키지를 사용합니다.

| 소비자 | 일반적인 사용 |
| --- | --- |
| `packages/realtime-chat` | API/Gateway adapter에서 HTTP DTO, socket event, outbound delivery event payload 사용 |
| frontend client | socket event와 HTTP DTO compile-time shape |

Boundary 규칙:

```txt
external boundary shape -> @wake-surfer/realtime-chat-contracts
feature-private behavior -> owning feature package
```

consumer가 API 또는 gateway feature package 내부 타입을 필요로 하더라도, 그 타입이 process/client boundary를 넘지 않는다면 이 패키지로 옮기지 않습니다.
