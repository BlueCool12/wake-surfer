# Stream Messages 구현 계획: 계획 역할과 고정 결정

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 1. 문서의 역할

이 문서는 Accepted 상태인 Stream Messages 설계 결정을 실제 GitHub 이슈와 PR로 옮기기 위한 실행
계획이다. `SMI-*`는 의존성을 설명하기 위한 계획 식별자이며 아직 GitHub 이슈 번호가 아니다.

각 이슈는 다음 원칙을 따른다.

- 하나의 이슈는 독립적으로 검증 가능한 결과 하나를 만든다.
- 한 이슈에서 package, API, Gateway, Web을 모두 조금씩 건드리는 방식보다 계약·provider·adapter·consumer를
  명시적으로 나눈다.
- HTTP route와 WebSocket event mapping은 `packages/realtime-chat-stream-messages`가 소유한다. API와
  Gateway app은 runtime resource를 만들고 package mount/register entrypoint만 호출한다.
- 각 기능 이슈는 자신의 단위·통합 테스트와 공개 문서 변경을 포함한다. 마지막 검증 이슈가 앞선 이슈의
  테스트를 대신하지 않는다.
- 공개 channel query는 실제 channel 권한 provider가 연결되기 전에는 mount하지 않는다.
- `message-send`, outbound delivery, read cursor의 전체 구현을 이 계획에 끌어들이지 않는다. 다만 조회
  불변조건을 보장하는 공통 message 계약, stream identity, write 크기 제한, 기존 stream target 검증은
  선행 범위에 포함한다.

실제 이슈를 생성할 때는 저장소 규칙에 따라 assignee를 `yullraes`로 지정한다. 작업 브랜치는
`<type>/<issue#>-<slug>` 형식을 사용하고, PR은 `BlueCool12`, `chan0324`에게 검토를 요청한다.

## 2. 구현 중 바꿀 수 없는 결정

이슈 구현 과정에서 다음 값을 다시 설계하지 않는다.

| 항목 | 확정값 |
| --- | --- |
| 공개 target | channel만 |
| Query slice | latest / sync-after / older의 독립 input·output·Handler |
| latest | 현재 head 기준 최대 5개, client limit 없음 |
| after·older limit | 기본 50, 최대 100, 최대 초과는 거절 |
| cursor | after·before 모두 exclusive, safe integer만 허용 |
| 정렬 | 모든 response는 sequence 오름차순 |
| snapshot | 첫 after page의 numeric `throughSequence`를 완료까지 고정 |
| 빈 channel | stream row를 만들지 않고 빈 성공 |
| message variant | `USER/TEXT`만 |
| text write | UTF-8 8KiB 이하 |
| Query envelope | 최종 JSON UTF-8 48KiB 이하 |
| 자동 recovery 묶음 | 10 page / 500 message / 512KiB 중 먼저 도달한 상한 |
| recovery 재개 | 마지막 완전 적용 cursor와 동일 watermark로 자동 재개 |
| 과거 가시 범위 | 현재 읽기 권한이 있으면 저장된 전체 history |
| client cursor 저장 | `sessionStorage`, actor+channel key, Gateway session ID 사용 금지 |
| transport | latest·older는 HTTP, after는 WebSocket relay |
| actor 신뢰 | public actor는 인증 세션/신뢰 edge, sync actor는 service credential로 인증된 Gateway의 local session |
| byte 측정 | contracts의 canonical final-envelope serializer로 Handler와 adapter가 동일 측정 |
