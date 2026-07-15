# Stream Messages 구현 이슈 문서

이 디렉터리는 구현 owner가 전체 계획을 읽지 않고 자신의 이슈 문서와 직접 선행 이슈(티켓)만 읽도록 분할한 실행 문서다.

## 공통 실행 문서

- [계획 역할과 고정 결정](./00-role-and-fixed-decisions.md)
- [저장소 선행 위험](./01-repository-risks.md)
- [의존성 그래프](./02-dependency-graph.md)
- [이슈 카탈로그](./03-issue-catalog.md)
- [병렬 실행 계획](./04-execution-waves.md)
- [출시 관문과 후속 capability](./05-release-gates-and-followups.md)
- [GitHub 이슈 생성 규칙](./06-github-issue-rules.md)
- [구현 순서 가이드](./07-implementation-order-guide.md)

## 외부 선행 이슈

- [DEP-AUTH-01](../issues/DEP-AUTH-01.md)
- [DEP-CH-01](../issues/DEP-CH-01.md)

## 내부 이슈

- [SMI-01 공통 공개 message 계약과 stream identity 분리](../issues/SMI-01.md)
- [SMI-02 Stream Messages 공개 Query 계약 정의](../issues/SMI-02.md)
- [SMI-03 PostgreSQL 통합 테스트 실행 기반 구축](../issues/SMI-03.md)
- [SMI-04 Message append application 불변조건 보강](../issues/SMI-04.md)
- [SMI-05 ChannelReadAuthorizer adapter 연결](../issues/SMI-05.md)
- [SMI-06 API 공통 오류·CORS·timeout 경계 일반화](../issues/SMI-06.md)
- [SMI-07 Latest Stream Messages Query 구현](../issues/SMI-07.md)
- [SMI-08 Older Stream Messages Query 구현](../issues/SMI-08.md)
- [SMI-09 Sync-after Stream Messages Query 구현](../issues/SMI-09.md)
- [SMI-10 Latest·Older package-owned public HTTP adapter 조립](../issues/SMI-10.md)
- [SMI-11 Package-owned internal sync API와 Gateway actor assertion 구현](../issues/SMI-11.md)
- [SMI-12 Package-owned Gateway WebSocket sync relay 구현](../issues/SMI-12.md)
- [SMI-13 Web sequence-aware message merge model 구현](../issues/SMI-13.md)
- [SMI-14 Web cursor 영속화와 제한된 자동 recovery 구현](../issues/SMI-14.md)
- [SMI-15 Web 실제 Stream Messages transport 구현](../issues/SMI-15.md)
- [SMI-16 Chat 화면에 latest·recovery·older 상태 연결](../issues/SMI-16.md)
- [SMI-17 생산자·소비자 계약 적합성 검증](../issues/SMI-17.md)
- [SMI-18 API–Gateway–PostgreSQL recovery E2E 검증](../issues/SMI-18.md)
- [SMI-19 Stream Messages 관측성과 운영 계약 마감](../issues/SMI-19.md)
- [SMI-20 Gateway service credential 인증 구현](../issues/SMI-20.md)
- [SMI-21 Gateway 인증 완료 event와 pre-ready 차단 구현](../issues/SMI-21.md)
- [SMI-22 Web authenticated realtime session bootstrap 구현](../issues/SMI-22.md)
- [SMI-23 Realtime Chat versioned migration runner 구축](../issues/SMI-23.md)
- [SMI-24 Message 8KiB DB constraint audit·migration](../issues/SMI-24.md)
- [SMI-25 Stream query distributed rate limit 구현](../issues/SMI-25.md)

## 작업 규칙

1. 자기 이슈 문서의 Read first만 먼저 읽는다.
2. 직접 선행 이슈가 완료되지 않았으면 그 이슈의 public 결과만 확인한다.
3. 더 깊은 근거가 필요할 때만 [설계 index](../design/README.md)로 이동한다.
4. notes/는 사람용 archive이며 agent 기본 context가 아니다.
