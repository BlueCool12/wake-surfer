# @wake-surfer/realtime-chat-contracts 테스트

현재 type-only 구현에는 별도 테스트가 필요하지 않습니다.

executable schema validation을 추가하면 다음을 테스트합니다.

- malformed socket payload reject
- malformed HTTP DTO reject
- 안정적인 event `type` string compatibility
- public error code membership
- boundary payload DTO serialization round trip
