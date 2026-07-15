# Stream Messages 구현 순서 가이드

> [구현 index](./README.md) | [의존성 그래프](./02-dependency-graph.md) | [이슈 목록](../issues/)

이 문서는 Stream Messages 구현 이슈를 **언제 시작하고 어떤 순서로 `dev`에 머지할지**만 정한다.
각 이슈의 범위와 결정 근거는 해당 이슈 문서에서 확인한다.

## 적용 규칙

1. 상위 이슈는 진행 상황 추적에만 사용하고, 실제 브랜치와 PR은 `DEP-*`, `SMI-*` 하위 이슈 단위로 만든다.
2. 선행 이슈가 모두 `dev`에 머지된 뒤 최신 `dev`에서 다음 작업 브랜치를 만든다. 구현 브랜치를 미리 전부 만들지 않는다.
3. 같은 단계의 이슈는 시작 조건을 충족하면 병렬 진행할 수 있다.
4. 공용 package 조립 파일이나 mount 파일을 함께 수정할 가능성이 높은 이슈는 아래의 머지 순서를 따른다.
5. 이 문서의 순서는 브랜치 계층이 아니다. 모든 독립 브랜치는 최신 `dev`에서 분기하고 `dev`로 합친다.

## 단계별 구현 순서

### 0단계 — 설계 문서 기준선

- 현재 설계 문서 이슈를 먼저 `dev`에 머지한다.
- 이후 구현 이슈는 이 문서와 자기 이슈 문서가 포함된 최신 `dev`에서 시작한다.

### 1단계 — 독립 기반

아래 이슈는 서로 독립적으로 시작할 수 있다.

- [DEP-CH-01 channel 기준 상태](../issues/DEP-CH-01.md)
- [DEP-AUTH-01 actor 인증 session](../issues/DEP-AUTH-01.md)
- [SMI-01 공통 공개 message 계약과 stream identity 분리](../issues/SMI-01.md)
- [SMI-03 PostgreSQL 통합 테스트 실행 기반 구축](../issues/SMI-03.md)
- [SMI-20 Gateway service credential 인증 구현](../issues/SMI-20.md)
- [SMI-21 Gateway 인증 완료 event와 pre-ready 차단 구현](../issues/SMI-21.md)

### 2단계 — 계약·저장소·Web 순수 모델

선행 조건을 충족한 항목끼리는 병렬 진행한다.

| 이슈 | 시작 조건 |
| --- | --- |
| [SMI-02 Stream Messages 공개 Query 계약 정의](../issues/SMI-02.md) | `SMI-01` 머지 |
| [SMI-04 Message append application 불변조건 보강](../issues/SMI-04.md) | `SMI-01`, `SMI-03` 머지 |
| [SMI-23 Realtime Chat versioned migration runner 구축](../issues/SMI-23.md) | `SMI-03` 머지 |
| [SMI-13 Web sequence-aware message merge model 구현](../issues/SMI-13.md) | `SMI-01`, `SMI-02` 머지 |
| [SMI-22 Web authenticated realtime session bootstrap 구현](../issues/SMI-22.md) | `DEP-AUTH-01`, `SMI-21` 머지 |

### 3단계 — 공통 경계와 DB 제약

| 이슈 | 시작 조건 |
| --- | --- |
| [SMI-06 API 공통 오류·CORS·timeout 경계 일반화](../issues/SMI-06.md) | `SMI-02` 머지 |
| [SMI-24 Message 8KiB DB constraint audit·migration](../issues/SMI-24.md) | `SMI-01`, `SMI-23` 머지 |
| [SMI-14 Web cursor 영속화와 제한된 자동 recovery 구현](../issues/SMI-14.md) | `SMI-13` 머지 |

### 4단계 — Provider 기준선

- [SMI-07 Latest Stream Messages Query 구현](../issues/SMI-07.md)
  - 시작 조건: `SMI-01`, `SMI-02`, `SMI-03`, `SMI-04`, `SMI-24` 머지
  - 이 이슈가 provider package의 최초 조립 기준선이므로 다음 provider 이슈보다 먼저 머지한다.

### 5단계 — Provider 확장과 권한 연결

`SMI-07`이 머지된 최신 `dev`에서 아래 브랜치를 각각 만든다. 세 이슈는 병렬 진행할 수 있다.

| 이슈 | 추가 시작 조건 |
| --- | --- |
| [SMI-05 ChannelReadAuthorizer adapter 연결](../issues/SMI-05.md) | `DEP-CH-01` 머지 |
| [SMI-08 Older Stream Messages Query 구현](../issues/SMI-08.md) | 없음 |
| [SMI-09 Sync-after Stream Messages Query 구현](../issues/SMI-09.md) | 없음 |

### 6단계 — API adapter 조립

1. [SMI-10 Latest·Older package-owned public HTTP adapter 조립](../issues/SMI-10.md)
   - 시작 조건: `DEP-AUTH-01`, `SMI-05`, `SMI-06`, `SMI-08` 머지
2. [SMI-11 Package-owned internal sync API와 Gateway actor assertion 구현](../issues/SMI-11.md)
   - 논리적 시작 조건: `SMI-05`, `SMI-06`, `SMI-09`, `SMI-20` 머지
   - 실제 작업 시작: `SMI-10`까지 머지된 최신 `dev` 권장

`SMI-10`과 `SMI-11`은 논리적으로는 병렬 구현할 수 있지만 API package 조립과 mount 파일에서 충돌할 가능성이
높다. 별도 공용 파일 소유자를 정하지 않는 한 **`SMI-10`을 먼저 머지하고 `SMI-11`을 이어서 구현·머지한다.**

### 7단계 — Gateway relay

- [SMI-12 Package-owned Gateway WebSocket sync relay 구현](../issues/SMI-12.md)
  - 시작 조건: `SMI-11`, `SMI-21` 머지

### 8단계 — 실제 소비 경로와 보호 장치

`SMI-12`가 머지된 뒤 아래 이슈를 진행한다. 시작 조건을 충족한 이슈끼리는 병렬 진행할 수 있다.

| 이슈 | 시작 조건 |
| --- | --- |
| [SMI-15 Web 실제 Stream Messages transport 구현](../issues/SMI-15.md) | `SMI-10`, `SMI-12`, `SMI-14`, `SMI-22` 머지 |
| [SMI-18 API–Gateway–PostgreSQL recovery E2E 검증](../issues/SMI-18.md) | `SMI-03`, `SMI-12` 머지 |
| [SMI-25 Stream query distributed rate limit 구현](../issues/SMI-25.md) | `SMI-02`, `SMI-10`, `SMI-12` 머지 |

### 9단계 — 소비자 연결과 계약 검증

| 이슈 | 시작 조건 |
| --- | --- |
| [SMI-16 Chat 화면에 latest·recovery·older 상태 연결](../issues/SMI-16.md) | `SMI-15` 머지 |
| [SMI-17 생산자·소비자 계약 적합성 검증](../issues/SMI-17.md) | `SMI-10`, `SMI-12`, `SMI-15`, `SMI-25` 머지 |

두 이슈는 각자의 시작 조건을 충족하면 병렬 진행할 수 있다.

### 10단계 — 운영 마감

- [SMI-19 Stream Messages 관측성과 운영 계약 마감](../issues/SMI-19.md)
  - 시작 조건: `SMI-16`, `SMI-17`, `SMI-18`, `SMI-25` 머지
  - Stream Messages 구현 작업의 마지막 이슈로 머지한다.

## 한눈에 보는 머지 관문

```text
설계 문서
  → 독립 기반(DEP-CH-01, DEP-AUTH-01, SMI-01, 03, 20, 21)
  → 계약·migration·Web 순수 모델(SMI-02, 04, 13, 22, 23)
  → 공통 경계·DB 제약(SMI-06, 14, 24)
  → Latest provider(SMI-07)
  → Provider 확장·권한(SMI-05, 08, 09)
  → Public HTTP(SMI-10)
  → Internal sync API(SMI-11)
  → Gateway relay(SMI-12)
  → Web transport·E2E·rate limit(SMI-15, 18, 25)
  → UI·계약 검증(SMI-16, 17)
  → 운영 마감(SMI-19)
```
