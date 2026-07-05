# @wake-surfer/realtime-chat-contracts 원칙

- generic record보다 명시적인 object DTO를 선호합니다.
- 이름은 usecase 구현이 아니라 protocol 기준으로 짓습니다.
- 모든 event `type` string은 public protocol이므로 union member는 신중하게 추가합니다.
- wire contract에서 실제로 생략 가능한 경우에만 optional field를 둡니다.
- 이 패키지는 framework-independent, runtime-neutral 상태를 유지합니다.
- contract를 executable schema로 설계하기 전까지 validation library를 추가하지 않습니다.
