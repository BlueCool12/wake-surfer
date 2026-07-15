# RCI-05 사람 identity·channel authorization production adapter 연결

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-02](./RCI-02.md)
- [DEP-AUTH-01](../../stream-messages/issues/DEP-AUTH-01.md)
- [DEP-CH-01](../../stream-messages/issues/DEP-CH-01.md)

### 관련 설계

- [Identity와 권한](../design/04-identity-and-authorization.md)
- [Domain Owner 결정](../design/08-domain-owner-decisions.md)

## 작업 정의

**목표**

공유 auth/channel provider의 공개 결과를 Read Cursor가 요구하는 stable human user와 channel read
authorization 계약으로 번역한다.

**주요 변경**

- 인증 session/Gateway assertion→stable canonical `userId` adapter
- channel 존재/membership→`ChannelReadAuthorizer` adapter
- provider denied/not-found/failure의 Read Cursor 의미 매핑
- production module composition과 fail-closed startup validation

**완료 조건**

- client-supplied actor/user ID가 production path에 들어오지 않는다.
- generic actor, bot, system, service principal이 human user로 통과하지 않는다.
- not-found와 denied는 `stream_unavailable`로 합쳐진다.
- provider 장애는 retryable failure로 보존된다.
- allow-all/development adapter로 production server를 시작할 수 없다.
- Stream Messages 내부 authorizer/query를 deep import하지 않고 같은 channel provider의 공개 계약만 소비한다.

**비범위**

- OAuth/session 도메인 구현
- channel membership 저장
- Read Cursor Handler

권장 브랜치 slug: `read-cursor-auth-adapters`
