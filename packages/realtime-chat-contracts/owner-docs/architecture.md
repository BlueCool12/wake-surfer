# @wake-surfer/realtime-chat-contracts 구조

이 패키지는 flat boundary contract provider입니다. runtime dependency가 없고, type/constant export 외의 behavior를 갖지 않습니다.

현재 source layout:

| 경로                       | 책임                                   |
| -------------------------- | -------------------------------------- |
| `src/primitives.ts`        | 공유 ID와 enum-like primitive alias    |
| `src/error-codes.ts`       | 공개 realtime chat error name          |
| `src/socket/*`             | client/server WebSocket event contract |
| `src/http/*`               | HTTP 및 process-boundary DTO           |
| `src/integration-events/*` | cross-context event contract           |
| `src/index.ts`             | package root export surface            |

package root는 모든 public contract를 re-export합니다. 파일 배치는 deep-import contract가 아닙니다.
