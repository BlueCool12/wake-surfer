# @wake-surfer/realtime-chat 테스트

초기 구현에서는 테스트를 추가하지 않았습니다.

테스트를 추가할 때 feature behavior test는 app이 아니라 이 패키지에 둡니다.

- gateway ticket issue와 consume behavior
- message permission denial
- message content validation
- DB port contract를 통한 stream sequence 및 idempotency behavior
- read cursor no-backward behavior
- stream sync limit handling
- outbound publish failure가 accepted message를 reject하지 않는지
- malformed socket payload가 `gateway.error`를 만드는지
- socket event가 API client DTO로 mapping되는지
- outbound event가 local recipient session에만 push되는지
