# DEP-AUTH-01 인증 actor session과 public trusted edge 제공

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

- [고정 결정](../implementation/00-role-and-fixed-decisions.md)
- [저장소 선행 위험](../implementation/01-repository-risks.md)
- [Stream Messages 공개 API](../../../public-docs/stream-messages/api.md)

## 작업 정의

**Owner**: auth/session 및 deployment edge

**필수 결과**

- Web이 로그인 actor를 식별하고 API ticket/query에 사용할 수 있는 안정적인 인증 session을 가진다.
- production API는 browser가 임의 지정한 `x-actor-id`를 직접 신뢰하지 않는다.
- trusted edge 또는 session middleware가 검증한 actor만 API auth context에 주입한다.
- 개발용 header adapter는 production에서 시작할 수 없도록 명시적으로 차단한다.
- logout/account change signal로 Web의 actor-scoped `sessionStorage`를 폐기할 수 있다.
- ticket 발급과 stream query가 같은 actor session을 사용한다.

이 이슈는 Stream Messages가 OAuth/session 도메인을 대신 구현한다는 뜻이 아니다. 다만 완료되지 않으면
`SMI-10`, `SMI-22`, `SMI-15`의 production consumer를 활성화할 수 없다.
