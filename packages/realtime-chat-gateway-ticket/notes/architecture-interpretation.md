# gateway-ticket 패키지의 아키텍처 해석

## 문서 목적

이 문서는 `docs/realtime-chat/realtime-chat-architecture.md`를 `gateway-ticket` 구현에 어떻게 적용했는지
기록한다.

원본 아키텍처 문서를 수정하거나 대체하지 않는다. 이 패키지를 볼 때 "왜 이런 패키지와 디렉터리 구조가
나왔는지"를 설명하기 위한 notes 문서다.

## 해석한 원칙

원본 문서에서 가장 중요하게 본 문장은 다음이다.

```txt
같은 이유로 바뀌는 코드는 가까이 둔다.
다른 이유로 바뀌는 코드는 분리한다.
```

`gateway-ticket`은 실시간 채팅 전체 기능이 아니다. 최초 WebSocket 연결 전에 사용하는 일회성 티켓의
발급과 소비만 책임진다.

그래서 이 패키지는 `realtime-chat-api` 안의 한 파일이 아니라 별도 feature 패키지로 잡았다. 티켓의
TTL, 원문 생성, 해시 저장, Gateway 배정 결과 기록, 원자적 소비 규칙은 같은 이유로 바뀔 가능성이 높다.

## feature package로 본 이유

원본 문서의 예시 패키지 목록은 다음처럼 큰 단위였다.

```txt
packages/
  realtime-chat-api/
  realtime-chat-gateway/
  realtime-chat-domain/
  realtime-chat-contracts/
```

하지만 원본 문서도 실제 패키지 이름은 구현 시점에 조정될 수 있다고 본다.

`gateway-ticket`은 API 서버에서 호출되는 기능이지만, 단순 API handler가 아니다. 분산 환경에서
Gateway 접속을 허용하기 전에 한 번만 소비되는 보안 티켓을 다룬다. 이 기능의 변경 이유는 메시지 저장,
읽음 처리, 세션 registry 같은 다른 채팅 요구사항과 다르다.

그래서 구현은 다음처럼 더 작은 feature package를 선택했다.

```txt
packages/
  realtime-chat-gateway-ticket/
  realtime-chat-gateway-ticket-contracts/
  realtime-chat-database/
```

이는 원본 문서의 철학과 충돌한다고 보지 않는다. 큰 `realtime-chat-api` 패키지 안에 넣는 대신, 변경
이유가 분명한 feature를 패키지 경계로 올린 해석이다.

## usecases 디렉터리로 본 이유

원본 문서는 `slice`를 "요청, 트랜잭션, 일관성 경계를 책임지는 구현 단위"라고 설명한다.

이 패키지에서는 코드 디렉터리 이름으로 `slice` 대신 `usecases`를 사용했다.

이유는 다음과 같다.

- `gateway-ticket` 패키지 자체가 feature 경계다.
- `issue-gateway-ticket`과 `consume-gateway-ticket`은 그 feature가 제공하는 실제 유스케이스다.
- `slice`라는 말보다 `usecase`가 코드 탐색 시 더 직접적이다.

따라서 구조는 다음처럼 잡았다.

```txt
src/
  usecases/
    issue-gateway-ticket/
    consume-gateway-ticket/
```

각 usecase 안에는 해당 유스케이스의 실행 규칙과 Kysely query를 함께 둔다. 원본 문서의 "특정 slice의
트랜잭션 규칙을 직접 표현하는 query는 slice 가까이에 둘 수 있다"는 원칙을 따른 것이다.

## DB 접근을 해석한 방식

처음에는 `gateway-ticket` 안에서 `pg Pool`까지 직접 만들 수 있다고 봤다. 하지만 다시 검토하면서
다음처럼 나누는 것이 더 맞다고 정리했다.

```txt
realtime-chat-database
  PostgreSQL Pool 생성
  Kysely 인스턴스 생성
  전체 DB 타입 합성
  공통 migrate/close 제공

realtime-chat-gateway-ticket
  gateway_tickets 테이블 계약 제공
  티켓 발급/소비 query 소유
  티켓 정책과 원자적 소비 규칙 소유
```

즉 `gateway-ticket`은 `db` 핸들을 주입받지만 저장 함수 자체를 주입받지는 않는다. 앱이나 database
패키지가 `saveIssuedGatewayTicket` 같은 내부 저장 함수를 조립하지 않는다.

이 결정은 다음 균형을 위한 것이다.

- DB 연결 풀 생명주기는 feature가 아니라 런타임 리소스 책임이다.
- 티켓 저장/소비 SQL은 gateway-ticket 변경 이유에 속한다.
- 앱은 DB 리소스와 feature를 조립하지만, feature 내부 SQL은 알지 않는다.

## table-contract 서브패스

`realtime-chat-database`는 전체 DB 타입을 합성해야 하므로 feature의 테이블 타입을 알아야 한다.

그래서 `gateway-ticket`은 루트 API가 아니라 별도 서브패스로 테이블 계약만 제공한다.

```txt
@wake-surfer/realtime-chat-gateway-ticket/table-contract
```

이 서브패스는 다음을 제공한다.

```txt
GatewayTicketDatabase
createGatewayTicketsTable
```

루트 공개 API에 올리지 않은 이유는 일반 앱 코드가 테이블 생성 함수나 테이블 타입을 직접 쓰는 흐름을
막기 위해서다. 다만 package export는 소비자별 접근 제한을 강제하지 못한다. 그래서 ESLint 규칙으로
`realtime-chat-database` 외의 import를 막는다.

## contracts 패키지

원본 문서는 domain과 contract를 분리한다.

이 원칙에 따라 요청/응답처럼 외부 경계에서 공유되는 타입은 별도 패키지로 뺐다.

```txt
@wake-surfer/realtime-chat-gateway-ticket-contracts
```

이 패키지는 프론트엔드, API, Gateway가 함께 참조할 수 있는 공개 타입만 가진다. 티켓 생성, 해시,
저장, 만료 계산, SQL은 구현 패키지의 책임이다.

## 현재 구조가 피하려는 것

이 패키지 구조는 다음을 피하려고 한다.

- 앱이 티켓 저장 SQL을 조립하는 것
- Gateway가 DB를 직접 만져 티켓을 검증하는 것
- `port`, `adapter`, `repository` 디렉터리를 만들고 실제 변경 이유와 무관한 레이어를 늘리는 것
- 모든 DB 접근을 하나의 거대한 repository로 모으는 것
- 프론트엔드가 서버 내부 티켓 모델이나 테이블 타입에 의존하는 것

## 요약

`gateway-ticket`은 원본 아키텍처 문서를 다음처럼 해석해서 구현했다.

```txt
feature = packages/realtime-chat-gateway-ticket
usecase = issue-gateway-ticket, consume-gateway-ticket
external contract = packages/realtime-chat-gateway-ticket-contracts
DB runtime resource = packages/realtime-chat-database
feature table contract = @wake-surfer/realtime-chat-gateway-ticket/table-contract
```

원본 문서와 가장 큰 차이는 패키지 토폴로지다. 원본 문서의 큰 예시 패키지보다 더 작은 feature package로
쪼갰다. 하지만 의도는 같다. 변경 이유가 같은 코드는 가까이 두고, 런타임 리소스, 외부 계약, feature
규칙은 서로 다른 경계에 둔다.
