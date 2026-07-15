# Read Cursor 구현 순서 가이드

> [구현 index](./README.md) | [의존성 그래프](./02-dependency-graph.md) | [이슈 목록](../issues/)

이 문서는 Read Cursor 구현 이슈를 **언제 시작하고 어떤 순서로 `dev`에 머지할지**만 정한다. 각 이슈의
범위와 결정 근거는 해당 이슈 문서에서 확인한다.

## 적용 규칙

1. 상위 이슈는 진행 상황 추적에만 사용하고 실제 브랜치와 PR은 `RCI-*` 하위 이슈 단위로 만든다.
2. 직접 선행 이슈와 공유 `DEP-*`/`SMI-*` 이슈가 모두 `dev`에 머지된 뒤 최신 `dev`에서 작업 브랜치를
   만든다. 구현 브랜치를 미리 전부 만들지 않는다.
3. 같은 단계의 이슈는 시작 조건을 충족하고 수정 파일 소유권이 겹치지 않을 때만 병렬 진행한다.
4. `@wake-surfer/realtime-chat-read-cursor`, API mount, Gateway mount 같은 공용 조립 파일을 함께 수정할
   가능성이 높은 이슈는 아래의 실제 머지 순서를 따른다.
5. 이 문서의 순서는 브랜치 계층이 아니다. 모든 독립 브랜치는 최신 `dev`에서 분기하고 `dev`로 합친다.
6. 공유 Stream Messages 이슈의 순서는
   [Stream Messages 구현 순서 가이드](../../stream-messages/implementation/07-implementation-order-guide.md)를
   따른다. Read Cursor를 위해 같은 기반 이슈를 복제하지 않는다.

## 공유 선행 관문

Read Cursor 이슈를 시작하기 전에 필요한 공유 결과는 다음과 같다.

| 공유 이슈 | Read Cursor에서 필요한 결과 |
| --- | --- |
| `SMI-01` | canonical stream identity와 공통 ID 계약 |
| `SMI-03` | 실제 PostgreSQL 통합 테스트 기반 |
| `SMI-23` | versioned migration runner |
| `DEP-AUTH-01` | stable human user session과 trusted public edge |
| `DEP-CH-01` | channel 존재·membership 기준 상태 |
| `SMI-06` | API 공통 오류·CORS·timeout 경계 |
| `SMI-20` | Gateway service credential |
| `SMI-21` | `gateway.connected`와 pre-ready 차단 |
| `SMI-13` | Web sequence-aware merge model |
| `SMI-15` | Web 실제 Stream Messages transport |
| `SMI-16` | Chat 화면의 Stream Messages lifecycle |
| `SMI-22` | Web authenticated realtime session |
| `SMI-25` | 재사용 가능한 분산 rate limiter 기반 |

공유 이슈 전체 완료를 기다린 뒤 Read Cursor를 한 번에 시작하지 않는다. 아래 각 단계는 자신에게 직접
필요한 공유 결과만 머지되면 진행한다.

## 단계별 구현 순서

### 0단계 — 설계·이슈 문서 기준선

- 현재 Read Cursor 설계와 `RCI-01`~`RCI-15` 이슈 문서를 먼저 `dev`에 머지한다.
- 실제 GitHub 이슈를 만들고 계획 ID와 GitHub 번호 대응표를 갱신한다.
- 이후 구현 브랜치는 이 기준선이 포함된 최신 `dev`에서 시작한다.

### 1단계 — 공개 계약

- [RCI-01 Read Cursor 공개 계약 정의](../issues/RCI-01.md)
  - 시작 조건: `SMI-01` 머지
  - 이 이슈가 Read Cursor의 모든 producer/consumer 계약 기준선이므로 다른 `RCI-*`보다 먼저 머지한다.

### 2단계 — 저장 기반과 Web 순수 모델

아래 이슈는 시작 조건을 충족하면 수정 영역이 달라 병렬 진행할 수 있다.

| 이슈 | 시작 조건 | 주요 수정 영역 |
| --- | --- | --- |
| [RCI-02 table contract와 database migration 합성](../issues/RCI-02.md) | `RCI-01`, `SMI-03`, `SMI-23` 머지 | feature/database package |
| [RCI-09 Web read observation 상태 모델](../issues/RCI-09.md) | `RCI-01`, `SMI-13` 머지 | Web 순수 상태 모델 |

### 3단계 — Feature provider 기준선

논리적으로 `RCI-03`과 `RCI-04`는 독립 usecase지만 같은 feature package의 module facade, root export,
package 설정을 수정할 가능성이 높다. 공용 파일 소유자를 따로 정하지 않는 한 다음 순서로 머지한다.

1. [RCI-03 Mark Read Cursor Command 구현](../issues/RCI-03.md)
   - 시작 조건: `RCI-01`, `RCI-02`, `SMI-03` 머지
   - feature package의 최초 provider 조립 기준선으로 먼저 머지한다.
2. [RCI-04 Get Channel Read State Query 구현](../issues/RCI-04.md)
   - 논리적 시작 조건: `RCI-01`, `RCI-02` 머지
   - 실제 작업 시작: `RCI-03`까지 머지된 최신 `dev` 권장

별도 파일 소유권을 보장할 수 있으면 구현은 병렬로 진행할 수 있지만, 두 번째 PR은 첫 번째 PR 머지 뒤 최신
`dev`로 rebase하고 package export/module 조립을 다시 검증한다.

### 4단계 — Production identity와 channel 권한 연결

- [RCI-05 사람 identity·channel authorization production adapter](../issues/RCI-05.md)
  - 논리적 시작 조건: `RCI-02`, `DEP-AUTH-01`, `DEP-CH-01` 머지
  - 실제 작업 시작: `RCI-04`까지 머지된 최신 `dev` 권장

이 이슈도 feature module 조립을 수정하므로 `RCI-03/04`와 동시에 머지하지 않는다. 완료 뒤 fake adapter가
production mount에 남아 있지 않은지 확인한다.

### 5단계 — API adapter 조립

1. [RCI-06 Package-owned internal mark API](../issues/RCI-06.md)
   - 시작 조건: `RCI-03`, `RCI-05`, `SMI-06`, `SMI-20` 머지
2. [RCI-07 Package-owned public read-state HTTP API](../issues/RCI-07.md)
   - 논리적 시작 조건: `RCI-04`, `RCI-05`, `SMI-06`, `DEP-AUTH-01` 머지
   - 실제 작업 시작: `RCI-06`까지 머지된 최신 `dev` 권장

두 이슈는 논리적으로 병렬이지만 API route registry, package mount, app shell 조립에서 충돌할 가능성이
높다. 별도 공용 파일 소유자를 정하지 않는 한 **internal mark API를 먼저 머지하고 public read-state API를
이어 머지한다.**

### 6단계 — Gateway relay

- [RCI-08 Gateway WebSocket mark relay](../issues/RCI-08.md)
  - 시작 조건: `RCI-06`, `SMI-21` 머지
  - Gateway가 DB나 Handler를 직접 호출하지 않고 internal API만 사용하는지 확인한다.

### 7단계 — 실제 소비 경로·보호·핵심 E2E

`RCI-08`이 머지된 뒤 아래 이슈를 진행한다. 수정 영역이 분리돼 있어 각 시작 조건을 충족하면 병렬 진행할
수 있다.

| 이슈 | 시작 조건 | 주요 수정 영역 |
| --- | --- | --- |
| [RCI-10 Web Read Cursor transport](../issues/RCI-10.md) | `RCI-07`, `RCI-08`, `RCI-09`, `SMI-15`, `SMI-22` 머지 | Web transport |
| [RCI-12 Read Cursor 분산 rate limit](../issues/RCI-12.md) | `RCI-06`, `RCI-07`, `RCI-08`, `SMI-25` 머지 | API/Gateway limiter 조립 |
| [RCI-14 API–Gateway–PostgreSQL E2E](../issues/RCI-14.md) | `RCI-02`, `RCI-06`, `RCI-07`, `RCI-08`, `SMI-03` 머지 | process test harness |

`RCI-12`가 API/Gateway mount를 수정하면서 다른 긴급 adapter 수정과 충돌하면 adapter owner가 먼저 머지하고
limiter PR을 최신 `dev`에 rebase한다. `RCI-14`는 core mark/read-state 의미를 검증하므로 rate limit 완료를
기다리지 않는다.

### 8단계 — 화면 lifecycle과 계약 검증

아래 이슈는 각자 시작 조건을 충족하면 병렬 진행할 수 있다.

| 이슈 | 시작 조건 |
| --- | --- |
| [RCI-11 Chat 화면 읽음 lifecycle 연결](../issues/RCI-11.md) | `RCI-10`, `SMI-16` 머지 |
| [RCI-13 생산자·소비자 계약 적합성 검증](../issues/RCI-13.md) | `RCI-06`, `RCI-07`, `RCI-08`, `RCI-10`, `RCI-12` 머지 |

`RCI-11`은 제품 동작을, `RCI-13`은 wire producer/consumer 일치를 검증하므로 서로를 대체하지 않는다.

### 9단계 — 운영·공개 문서 마감

- [RCI-15 관측성·운영 계약·공개 문서 마감](../issues/RCI-15.md)
  - 시작 조건: `RCI-11`, `RCI-12`, `RCI-13`, `RCI-14` 머지
  - Read Cursor 구현 작업의 마지막 이슈로 머지한다.
  - 이때만 검증된 consumer contract를 `public-docs/read-cursor/`에 만들고 AGENTS consumer route를 연다.

## 한눈에 보는 머지 관문

```text
설계·이슈 문서
  → SMI-01
  → RCI-01 계약
  → RCI-02 table/migration ─┐
  → RCI-09 Web 순수 모델 ──┤
  → RCI-03 Mark provider
  → RCI-04 Read-state provider
  → RCI-05 Production auth/channel adapter
  → RCI-06 Internal mark API
  → RCI-07 Public read-state API
  → RCI-08 Gateway relay
  → RCI-10 Web transport · RCI-12 rate limit · RCI-14 E2E
  → RCI-11 Chat lifecycle · RCI-13 contract 검증
  → RCI-15 운영·공개 문서 마감
```

## 공용 파일 충돌 시 우선순위

| 공용 영역 | 기본 머지 순서 |
| --- | --- |
| Read Cursor feature module/export | `RCI-02` → `RCI-03` → `RCI-04` → `RCI-05` |
| API route registry/mount | `RCI-06` → `RCI-07` → `RCI-12` |
| Gateway event registry/mount | `RCI-08` → `RCI-12` |
| Web chat transport/state 조립 | `RCI-09` → `RCI-10` → `RCI-11` |

표의 뒤 이슈는 앞 이슈가 머지된 최신 `dev`에서 새 브랜치를 만드는 것이 기본이다. 병렬 구현이 꼭
필요하면 공용 파일 소유자를 한 명으로 정하고, 뒤 PR은 머지 직전 최신 `dev` 기준으로 재검증한다.
