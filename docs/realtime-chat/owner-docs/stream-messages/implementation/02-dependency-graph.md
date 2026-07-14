# Stream Messages 구현 계획: 의존성 그래프

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 5. 의존성 개요

```mermaid
flowchart LR
  DCH["DEP-CH-01 channel 기준 상태"]
  DAUTH["DEP-AUTH-01 actor 인증 session"]

  I01["SMI-01 공통 message 계약"] --> I02["SMI-02 Query 계약"]
  I01 --> I04["SMI-04 append application 불변조건"]
  I03["SMI-03 PostgreSQL 테스트 기반"] --> I04
  I03 --> I23["SMI-23 migration runner"]
  I23 --> I24["SMI-24 DB constraint upgrade"]
  I01 --> I24
  I02 --> I06["SMI-06 API 공통 경계"]

  I02 --> I07["SMI-07 Latest provider"]
  I03 --> I07
  I04 --> I07
  I24 --> I07
  I07 --> I05["SMI-05 channel authorizer adapter"]
  DCH --> I05
  I07 --> I08["SMI-08 Older provider"]
  I07 --> I09["SMI-09 Sync-after provider"]

  I05 --> I10["SMI-10 Public HTTP adapter"]
  DAUTH --> I10
  I06 --> I10
  I08 --> I10

  I20["SMI-20 Gateway service credential"] --> I11["SMI-11 Internal sync API"]
  I05 --> I11["SMI-11 Internal sync API"]
  I06 --> I11
  I09 --> I11
  I21["SMI-21 gateway.connected"] --> I12["SMI-12 Gateway WS relay"]
  I11 --> I12["SMI-12 Gateway WS relay"]

  I01 --> I13["SMI-13 Web merge model"]
  I02 --> I13
  I13 --> I14["SMI-14 Cursor/recovery"]
  DAUTH --> I22["SMI-22 Web realtime session"]
  I21 --> I22
  I10 --> I15["SMI-15 Web transport"]
  I12 --> I15
  I14 --> I15
  I22 --> I15
  I15 --> I16["SMI-16 Chat UI 연결"]

  I10 --> I17["SMI-17 계약 적합성"]
  I12 --> I17
  I15 --> I17
  I12 --> I18["SMI-18 process E2E"]
  I03 --> I18
  I16 --> I19["SMI-19 관측성·운영 문서"]
  I17 --> I19
  I18 --> I19
  I02 --> I25["SMI-25 distributed rate limit"]
  I10 --> I25
  I12 --> I25
  I25 --> I17
  I25 --> I19
```

`DEP-CH-01`, `DEP-AUTH-01`이 늦어져도 provider와 Web 순수 모델은 fake authorizer/transport로 병렬 개발할
수 있다. 그러나 public/internal production 조립과 실제 Web transport, 이후 출시 관문은 통과할 수 없다.
