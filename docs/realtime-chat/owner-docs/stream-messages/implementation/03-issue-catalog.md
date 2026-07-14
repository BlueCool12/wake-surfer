# Stream Messages 구현 계획: 이슈 카탈로그

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 6. 이슈 목록

| ID | 이슈 제목 | 종류 | 주요 결과 | 선행 이슈 |
| --- | --- | --- | --- | --- |
| SMI-01 | 공통 공개 message 계약과 stream identity 분리 | feat | canonical `PublicMessage`, 8KiB 규칙, stream ID owner | 없음 |
| SMI-02 | Stream Messages 공개 Query 계약 정의 | feat | 세 독립 schema와 wire error/cursor 의미 | SMI-01 |
| SMI-03 | PostgreSQL 통합 테스트 실행 기반 구축 | test | 실제 PG 18 격리 테스트 경로 | 없음 |
| SMI-04 | Message append application 불변조건 보강 | fix | 8KiB use case 검증과 target mismatch 차단 | SMI-01, SMI-03 |
| SMI-05 | ChannelReadAuthorizer adapter 연결 | feat | channel source를 consumer contract로 번역 | SMI-07, DEP-CH-01 |
| SMI-06 | API 공통 오류·CORS·timeout 경계 일반화 | refactor | ticket과 stream query 오류 분리, GET 허용 | SMI-02 |
| SMI-07 | Latest Stream Messages Query 구현 | feat | read-only latest provider/Handler | SMI-01~04, SMI-24 |
| SMI-08 | Older Stream Messages Query 구현 | feat | exclusive before pagination | SMI-07 |
| SMI-09 | Sync-after Stream Messages Query 구현 | feat | fixed watermark recovery page | SMI-07 |
| SMI-10 | Latest·Older package-owned HTTP adapter 조립 | feat | 인증된 channel HTTP 조회와 app mount | SMI-05, SMI-06~08, DEP-AUTH-01 |
| SMI-11 | Package-owned internal sync API와 Gateway actor assertion 구현 | feat | 인증 Gateway 전용 page API와 app mount | SMI-05, SMI-06, SMI-09, SMI-20 |
| SMI-12 | Package-owned Gateway WebSocket sync relay 구현 | feat | `chat.stream.sync` request/result relay와 app mount | SMI-11, SMI-21 |
| SMI-13 | Web sequence-aware message merge model 구현 | feat | 모든 message 입력의 단일 merge 상태 모델 | SMI-01, SMI-02 |
| SMI-14 | Web cursor 영속화와 제한된 자동 recovery 구현 | feat | reload 복원, 10/500/512 자동 재개 | SMI-13 |
| SMI-15 | Web 실제 Stream Messages transport 구현 | feat | latest/older HTTP, after WS | SMI-10, SMI-12, SMI-14, SMI-22 |
| SMI-16 | Chat 화면에 latest·recovery·older 상태 연결 | feat | 배열 교체 제거와 실제 UI 흐름 | SMI-15 |
| SMI-17 | 생산자·소비자 계약 적합성 검증 | test | API/Gateway/Web golden fixture 검증 | SMI-10, SMI-12, SMI-15, SMI-25 |
| SMI-18 | API–Gateway–PostgreSQL recovery E2E 검증 | test | 실제 process 경계의 조회·복구 검증 | SMI-03, SMI-10~12 |
| SMI-19 | Stream Messages 관측성과 운영 계약 마감 | feat/docs | 구조화 로그, 운영 대응, 최종 public docs | SMI-16~18, SMI-25 |
| SMI-20 | Gateway service credential 인증 구현 | feat/security | internal API의 실제 Gateway 인증 | 없음 |
| SMI-21 | Gateway 인증 완료 event와 pre-ready 차단 구현 | feat | `gateway.connected`와 event readiness | 기존 ticket/session flow |
| SMI-22 | Web authenticated realtime session bootstrap 구현 | feat | ticket 발급, WS 연결·재연결, connection generation | SMI-21, DEP-AUTH-01 |
| SMI-23 | Realtime Chat versioned migration runner 구축 | feat | 기존 schema를 안전하게 upgrade하는 기반 | SMI-03 |
| SMI-24 | Message 8KiB DB constraint audit·migration | fix | 기존 row audit와 idempotent CHECK 적용 | SMI-01, SMI-23 |
| SMI-25 | Stream query distributed rate limit 구현 | feat/security | Redis 기반 HTTP/WS abuse 보호 | SMI-02, SMI-10, SMI-12 |
