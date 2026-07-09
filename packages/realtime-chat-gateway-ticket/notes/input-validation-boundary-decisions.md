# gateway-ticket 입력 검증 경계 기록

## 문서 목적

이 문서는 `gateway-ticket`에 추가한 입력 검증이 어떤 성격인지 기록한다.

현재 검증은 완성된 식별자 정책이나 인증 정책을 구현한 것이 아니다. 아직 인증 서버, Gateway registry,
Gateway assignment 정책이 확정되지 않았으므로, 지금 들어간 검증은 구체적인 도메인 정책이라기보다
서버 내부 조립 오류를 빨리 드러내기 위한 최소 invariant에 가깝다.

이 문서는 현재 contract가 아니다. 나중에 인증/게이트웨이 정책이 확정되면 README나 public contract로
승격할 내용을 다시 정리해야 한다.

## 왜 껍데기처럼 보이는가

현재 검증은 다음 정도만 본다.

```txt
actorId
  공백이 아닌 문자열인가

gatewayId
  공백이 아닌 문자열인가

gatewayUrl
  URL로 파싱 가능한가
  ws 또는 wss 프로토콜인가

ticket
  consume 유스케이스에서 공백이면 rejected 값으로 반환
```

이 검증은 "actorId는 어떤 포맷이어야 한다", "gatewayId는 어디에 등록되어 있어야 한다", "gatewayUrl은
어떤 allowlist에 있어야 한다" 같은 정책을 아직 표현하지 않는다.

그래서 구체적인 정책 검증이라기보다, 지금 단계에서는 다음 실수를 막는 방어선이다.

- 인증 결과 없이 빈 `actorId`로 티켓을 발급하는 실수
- Gateway 정체성이 확정되지 않았는데 빈 `gatewayId`로 consume을 호출하는 실수
- `https://...` 같은 WebSocket 접속 주소가 아닌 값을 클라이언트에게 내려주는 실수
- 공백 티켓을 해시하거나 DB까지 보내는 불필요한 처리

## 현재 검증을 정책으로 보지 않는 이유

`actorId` 정책은 인증 서버가 정해야 한다.

JWT의 `sub`를 그대로 쓸지, 내부 user id를 쓸지, 봇이나 서비스 계정을 어떤 namespace로 표현할지는 아직
이 패키지에서 결정할 수 없다. 따라서 지금 `actorId`에 UUID, snowflake, CUID 같은 포맷을 강제하지
않는다.

`gatewayId` 정책도 Gateway registry나 deployment 모델이 정해야 한다.

정적 gateway 설정만 쓸지, registry에서 할당할지, Gateway 인증 주체와 gateway id를 어떻게 매핑할지는
아직 확정되지 않았다. 그래서 지금은 빈 문자열만 막고, id 포맷이나 등록 여부는 검증하지 않는다.

`gatewayUrl`은 서버가 내려주는 값이지만 그래도 최소 검증을 한다.

이 검증은 클라이언트 입력을 방어하기 위한 것이 아니라, 서버 내부 assignment 결과가 깨졌을 때 잘못된
접속 주소를 응답으로 내보내지 않기 위한 것이다. 그래서 실패하면 rejected 값이 아니라 `throw Error`가
맞다.

## 실패 처리 기준

현재 기준은 다음과 같다.

```txt
도메인 실패
  사용자가 제시한 ticket이 비어 있거나 유효하지 않음
  ticket 없음, 만료, 재사용, assigned gateway 불일치
  => rejected 값 반환

인프라 또는 내부 조립 실패
  actorId가 비어 있음
  gatewayId가 비어 있음
  gatewayUrl이 WebSocket URL이 아님
  crypto, DB, 쿼리 반환 모양 오류
  => throw Error
```

`ticket`은 외부 접속권이므로 공백이어도 무효 티켓이라는 도메인 실패로 본다.

반면 `actorId`와 `gatewayId`는 클라이언트 body에서 온 값이 아니라, 서버가 인증/내부 컨텍스트로 확정해야
하는 값이다. 이 값이 비어 있으면 사용자의 티켓이 나쁜 것이 아니라 서버 조립이 잘못된 것이다.

## 나중에 정책이 확정되면 바뀔 수 있는 부분

인증 서버가 확정되면 다음을 다시 결정해야 한다.

- `actorId`가 JWT `sub`인지 내부 user id인지
- bot, system actor, service account를 같은 actor id 공간에 둘지
- actor id 포맷을 강제할지

Gateway registry나 배포 모델이 확정되면 다음을 다시 결정해야 한다.

- `gatewayId` 포맷
- Gateway 인증 주체와 `gatewayId` 매핑 방식
- `gatewayUrl` allowlist 또는 registry 조회 검증
- 개발/운영 환경에서 `ws`를 허용할지, 운영에서 `wss`만 허용할지

그 전까지 지금 검증은 "정책 구현"이 아니라 "정책이 비어 있는 상태에서도 명백히 잘못된 조립을 막는
최소 안전장치"로만 본다.

## 테스트의 의미

현재 단위 테스트도 완성된 정책 테스트가 아니다.

테스트가 고정하는 것은 다음뿐이다.

- 빈 `actorId`와 `gatewayId`는 내부 계약 위반이다.
- `gatewayUrl`은 WebSocket URL이어야 한다.
- 빈 `ticket`은 throw가 아니라 rejected 값으로 처리한다.
- id 포맷은 아직 강제하지 않는다.

나중에 실제 정책이 정해지면 이 테스트들은 구체 정책 테스트로 대체되거나 강화되어야 한다.
