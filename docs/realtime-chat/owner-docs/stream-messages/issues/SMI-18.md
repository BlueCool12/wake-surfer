# SMI-18 API–Gateway–PostgreSQL recovery E2E 검증

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-03](./SMI-03.md)
- [SMI-10](./SMI-10.md)
- [SMI-11](./SMI-11.md)
- [SMI-12](./SMI-12.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [04-sync-after.md](../design/04-sync-after.md)
- [09-performance-and-payload.md](../design/09-performance-and-payload.md)
- [11-acceptance-and-non-goals.md](../design/11-acceptance-and-non-goals.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-18. API–Gateway–PostgreSQL recovery E2E 검증

**목표**

mock boundary를 넘어 실제 API, Gateway, PostgreSQL 사이의 핵심 조회·복구 의미를 검증한다.

**필수 시나리오**

- 읽을 수 있는 빈 channel latest
- 최신 5개와 여러 older page
- WebSocket sync-after 다중 page
- 첫 page 뒤 concurrent append와 고정 watermark
- 권한 거절 시 content query 미실행
- invalid cursor, sequence gap, stream target mismatch
- 48KiB byte-aware page split과 oversized row failure
- 중단 뒤 마지막 성공 cursor에서 재개
- Gateway reconnect 후 local-session actor assertion
- requestId end-to-end correlation

**완료 조건**

- 실제 PostgreSQL 18과 실제 HTTP/WS server를 사용한다.
- 테스트용 권한 provider는 allow/deny/failure를 명시적으로 제어한다.
- process 종료와 abort 뒤 열린 handle이 남지 않는다.
- 테스트가 한 명령으로 재현되고 실패 로그에 message content가 노출되지 않는다.

권장 브랜치 slug: `stream-messages-e2e`

---
