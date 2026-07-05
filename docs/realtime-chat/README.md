# realtime-chat docs

이 폴더는 realtime-chat 설계 기록을 둔다.

## 현재 기준 문서

| 문서                     | 용도                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `adr/README.md`          | realtime-chat 구조, 런타임 의존성, DB, 테스트 전략 결정 기록                          |
| `flow-sequence-guide.md` | API app, gateway app, package adapter를 지나는 주요 런타임 흐름                       |
| `package-owned-flows.md` | apps를 thin shell로 두고 `packages/realtime-chat` adapter가 흐름을 소유하는 기준 설명 |

## 정리된 중복 문서

다음 문서는 현재 기준 문서와 중복되거나 현재 구현과 맞지 않아 제거했다.

| 제거 문서                           | 이유                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `realtime-chat-sequence-flows.md`   | `flow-sequence-guide.md`와 동일한 내용의 중복 파일                            |
| `gateway-relay-sequence.md`         | relay 흐름의 구버전 요약이며, 현재 없는 문서 링크와 오래된 브로커 설명을 포함 |
| `realtime-chat-package-owned-docs/` | 폴더만 제거하고 내용은 `package-owned-flows.md`로 이동                        |
