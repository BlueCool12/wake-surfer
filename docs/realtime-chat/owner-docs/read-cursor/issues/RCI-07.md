# RCI-07 Package-owned public read-state HTTP API 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-04](./RCI-04.md)
- [RCI-05](./RCI-05.md)
- [DEP-AUTH-01](../../stream-messages/issues/DEP-AUTH-01.md)
- [SMI-06 API 공통 경계](../../stream-messages/issues/SMI-06.md)

### 관련 설계

- [입출력과 transport](../design/06-contracts-and-transport.md)
- [Unread와 client state](../design/07-unread-and-client-state.md)

## 작업 정의

**목표**

인증된 사람 사용자가 화면 진입/reload에서 read state를 조회하는 package-owned public HTTP route를 구현한다.

**주요 변경**

- channel selector와 strict query/path validation
- trusted public auth context→Query mapping
- effective cursor/`hasUnread` response mapping
- CORS, timeout, abort, 공통 오류 처리
- API shell mount 연결

**완료 조건**

- client actor/user header를 production에서 직접 신뢰하지 않는다.
- readable empty channel이 cursor 0, `hasUnread = false`로 성공한다.
- not-found/forbidden을 `stream_unavailable`로 통합한다.
- Query 결과를 읽는 동안 cursor row를 만들거나 수정하지 않는다.
- browser preflight와 인증 실패 계약 test가 있다.
- app shell에 Query 로직이 없다.

**비범위**

- inbox 목록
- exact unread count
- Web client

권장 브랜치 slug: `channel-read-state-http`
