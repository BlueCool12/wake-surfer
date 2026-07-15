# Read Cursor 설계: Identity, 권한, 정보 은닉

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## 사람 사용자 identity

- client payload의 `actorId`, `userId`, role, membership은 받거나 신뢰하지 않는다.
- Gateway는 인증된 local session에서 principal을 얻는다.
- API는 인증 edge 또는 service credential로 인증된 Gateway assertion만 신뢰한다.
- runtime `actorId`는 사람 사용자의 stable canonical `userId`로 해석한 뒤 저장한다.
- 봇·system·service account는 ReadCursor principal로 지원하지 않는다.
- 사람 사용자로 해석할 수 없는 principal은 fail closed하며 cursor를 만들거나 변경하지 않는다.

identity 계약이 `actorId == userId`를 사용하더라도 그 값이 장기 사용자 identity로 안정적이라는 보장이
명시돼야 한다.

## 처리 순서

1. payload 형태와 sequence 범위를 검증한다.
2. adapter가 신뢰된 인증 문맥과 검증된 요청을 Handler에 전달한다.
3. Handler가 principal을 canonical human user로 해석한다.
4. Handler가 channel read permission을 확인한다.
5. Handler가 primary DB에서 canonical stream과 head를 해석한다.
6. mark는 상한 검증과 조건부 cursor 전진을 수행한다.

read-state Query도 identity와 권한 확인을 data 조회보다 먼저 수행한다.

## 정보 은닉과 TOCTOU

- channel 없음과 read permission 없음은 외부에 같은 `stream_unavailable`을 반환한다.
- 권한 거절 전에 stream row, head, cursor를 조회하지 않는다.
- 권한 provider 장애는 도메인 거절로 위장하지 않고 retryable infrastructure failure로 처리한다.
- 권한 확인과 짧은 DB 트랜잭션 사이의 membership 변경 경쟁은 Stream Messages와 같은 짧은 TOCTOU를
  허용한다.
- 거절 응답에 실제 stream head나 기존 cursor를 포함하지 않는다.

강한 권한 직렬화는 channel provider와 같은 트랜잭션 경계를 요구하므로 현재 범위에 포함하지 않는다.
