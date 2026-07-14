# Stream Messages 설계: 문서 역할과 근거

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 1. 문서의 역할

이 문서는 `stream-messages` capability group의 유스케이스 경계와 조회 의미를 확정한 최종 설계
결정문이다.

도메인 결정권자는 2026-07-14에 모든 도메인 권고안을 승인했고, 같은 날 `SM-19`, `SM-23`의 기술 제한값도
확정했다. 이 문서는 stream messages 구현 계획의 상위 source of truth다. 이후 package, contract, API,
Gateway, Web 작업을 나누는
[이슈 단위 구현 계획](../implementation/README.md)은 이 결정의 의미를 바꾸지 않고 실행
단위로만 분해한다.

이 문서가 답하려는 질문은 다음과 같다.

- 저장된 stream 메시지를 읽는 실제 Query slice는 무엇인가?
- 최초 진입, 누락 복구, 과거 더보기는 같은 요청인가, 서로 다른 요청인가?
- `afterSequence`, `beforeSequence`, snapshot watermark의 의미는 무엇인가?
- channel, DM, thread에 같은 조회 규칙을 적용할 수 있는가?
- 실시간 메시지 수신은 이 capability group에 포함되는가?
- 현재 코드에서 재사용할 수 있는 저장 계약과 새로 확정한 공개 계약은 무엇인가?

## 2. 근거의 우선순위

설계 배경으로 제공된 대화는 CQRS 구현 단위와 capability group/slice 구분을 세우는 데 사용한다. 다만
현재 저장소의 공개 계약을 대체하지는 않는다.

목표 계약과 현재 배포 계약을 구분한다.

1. 새 `stream-messages` 구현의 목표 의미는 이 Accepted 결정문이 최우선이다.
2. 구현이 완료되기 전 현재 배포 동작은 source code, provider `README.md`, app `public-docs/`가 설명한다.
3. tracked 아키텍처 문서인 [realtime-chat-architecture.md](../../../realtime-chat-architecture.md)는 package와 runtime
   경계를 설명한다.
4. 사람용 flow 제안, 구현 계획, 설계 배경 대화는 위 결정을 해석하는 보조 근거다.

구현 계획은 이 문서의 외부 의미를 변경하지 않고 작업 단위로만 분해한다. 구현 완료 뒤에는 provider
`README.md`와 app `public-docs/`를 갱신해 실제 배포 계약과 이 결정문을 일치시킨다.

다음 문서들은 중요한 분석 자료지만 스스로 현재 계약이 아니라고 선언한다.

- [flow-sequence-guide.md](../../../flow-sequence-guide.md)
- [domain-event-storming-report.md](../../../domain-event-storming-report.md)
- [Flow 07 — publish 실패와 afterSequence 복구](../../../notes/implementation-plans/flow-07-publish-failure-after-sequence-recovery.md)
- [Flow 09 — 재접속과 누락 메시지 동기화](../../../notes/implementation-plans/flow-09-reconnect-missed-message-sync.md)
- [Flow 12 — DM 메시지 전송](../../../notes/implementation-plans/flow-12-dm-message-send.md)
- [Flow 13 — thread reply 전송](../../../notes/implementation-plans/flow-13-thread-reply-send.md)

`flow-sequence-guide.md`가 우선하라고 안내하는 `package-owned-flows.md`와
`packages/realtime-chat/owner-docs/*`는 현재 저장소에 없다. 따라서 존재하지 않는 문서를 확정 근거로
가정하지 않는다.
