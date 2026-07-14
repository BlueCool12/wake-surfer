# SMI-17 생산자·소비자 계약 적합성 검증

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-10](./SMI-10.md)
- [SMI-12](./SMI-12.md)
- [SMI-15](./SMI-15.md)
- [SMI-25](./SMI-25.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [11-acceptance-and-non-goals.md](../design/11-acceptance-and-non-goals.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-17. 생산자·소비자 계약 적합성 검증

**목표**

contracts, API, Gateway, Web이 같은 wire value와 오류를 해석하는지 자동 검증한다.

**완료 조건**

- versioned golden fixtures를 contracts package가 소유한다.
- API가 생성한 latest/older/after response가 schema를 통과한다.
- Gateway와 Web은 손수 작성한 느슨한 type guard 대신 contract parser를 사용한다.
- unknown actor/field, unsafe integer, limit 101, invalid watermark를 모두 거절한다.
- 8,192/8,193 text byte 경계와 49,152/49,153 envelope 경계를 검증한다.
- `USER/TEXT`는 허용하고 `SYSTEM`은 거절한다.
- domain rejection과 retryable infrastructure failure fixture가 다르다.
- HTTP/WS `rate_limited`와 `retryAfterMs`를 producer와 Web consumer가 같은 의미로 해석한다.
- 각 consumer package에서 같은 fixture suite를 실행할 수 있다.

권장 브랜치 slug: `stream-messages-contract-tests`

---
