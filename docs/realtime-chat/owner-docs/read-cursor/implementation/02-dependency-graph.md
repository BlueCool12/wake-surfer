# Read Cursor 구현 계획: 의존성 그래프

> [구현 index](./README.md) | [설계 index](../design/README.md)

```mermaid
flowchart LR
  DAUTH["DEP-AUTH-01 human auth session"]
  DCH["DEP-CH-01 channel source"]
  S01["SMI-01 stream identity"]
  S03["SMI-03 PostgreSQL test"]
  S06["SMI-06 API common boundary"]
  S13["SMI-13 Web merge model"]
  S15["SMI-15 Web transport"]
  S16["SMI-16 Chat UI"]
  S20["SMI-20 Gateway credential"]
  S21["SMI-21 gateway.connected"]
  S22["SMI-22 Web auth realtime"]
  S23["SMI-23 migration runner"]
  S25["SMI-25 distributed limiter"]

  S01 --> R01["RCI-01 contracts"]
  R01 --> R02["RCI-02 table/migration"]
  S03 --> R02
  S23 --> R02

  R01 --> R03["RCI-03 mark provider"]
  R02 --> R03
  S03 --> R03
  R01 --> R04["RCI-04 read-state provider"]
  R02 --> R04

  DAUTH --> R05["RCI-05 identity/auth adapters"]
  DCH --> R05
  R02 --> R05

  R03 --> R06["RCI-06 internal mark API"]
  R05 --> R06
  S06 --> R06
  S20 --> R06

  R04 --> R07["RCI-07 public read-state API"]
  R05 --> R07
  S06 --> R07
  DAUTH --> R07

  R06 --> R08["RCI-08 Gateway relay"]
  S21 --> R08

  R01 --> R09["RCI-09 Web observation model"]
  S13 --> R09
  R07 --> R10["RCI-10 Web transport"]
  R08 --> R10
  R09 --> R10
  S15 --> R10
  S22 --> R10
  R10 --> R11["RCI-11 Chat lifecycle"]
  S16 --> R11

  R06 --> R12["RCI-12 rate limit"]
  R07 --> R12
  R08 --> R12
  S25 --> R12

  R06 --> R13["RCI-13 contract fixtures"]
  R07 --> R13
  R08 --> R13
  R10 --> R13
  R12 --> R13

  R02 --> R14["RCI-14 process E2E"]
  R06 --> R14
  R07 --> R14
  R08 --> R14
  S03 --> R14

  R11 --> R15["RCI-15 operations/docs"]
  R12 --> R15
  R13 --> R15
  R14 --> R15
```

공유 선행 이슈가 늦어져도 `RCI-01`, 순수 provider, Web observation model은 fake provider/transport로 개발할
수 있다. production mount와 출시 관문은 실제 auth/channel/Gateway 기반 없이 통과할 수 없다.
