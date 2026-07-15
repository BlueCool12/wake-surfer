# RCI-13 Read Cursor 생산자·소비자 계약 적합성 검증

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-06](./RCI-06.md)
- [RCI-07](./RCI-07.md)
- [RCI-08](./RCI-08.md)
- [RCI-10](./RCI-10.md)
- [RCI-12](./RCI-12.md)

### 관련 설계

- [입출력과 transport](../design/06-contracts-and-transport.md)
- [Acceptance criteria](../design/09-acceptance-and-non-goals.md)

## 작업 정의

**목표**

contracts package의 canonical fixture 하나로 API, Gateway, Web producer/consumer가 같은 mark/read-state 의미를
사용하는지 검증한다.

**필수 fixture**

- mark advanced/unchanged
- invalid payload와 unknown field
- `stream_unavailable`, `invalid_cursor`, retryable failure
- empty channel read state
- requester-only correlation
- rate-limited HTTP/WS result

**완료 조건**

- 모든 producer output을 contracts schema가 parse한다.
- 모든 consumer가 canonical fixture를 해석한다.
- internal DTO와 client DTO를 혼용하면 test가 실패한다.
- actor/user 필드를 추가하면 strict schema가 실패한다.
- `commandId`, channel, canonical stream, effective cursor가 경계마다 보존된다.
- fixture에 message content나 민감한 identity 정보가 없다.

**비범위**

- 실제 PostgreSQL 경쟁
- browser rendering
- 부하 시험

권장 브랜치 slug: `read-cursor-contract-tests`
