# Stream Messages 공개 불변조건

## Message

- message variant는 `USER/TEXT`만 지원한다.
- text write는 UTF-8 8,192 byte 이하만 허용한다.
- history item에는 `clientMessageId`를 노출하지 않는다.
- canonical stream identity는 send와 query가 공유한다.

## Visibility

- 조회 전 channel read authorization을 수행한다.
- 현재 읽기 권한이 있으면 저장된 전체 history를 조회할 수 있다.
- 과거 history의 별도 lower bound는 없다.
- 빈 channel은 placeholder stream이 아니라 빈 성공 page다.
- 첫 reply 전의 빈 thread는 조회 대상이 아니다.

## Page

- query는 message, stream head, read cursor를 수정하지 않는다.
- page는 하나의 stream만 포함한다.
- latest는 최대 5개다.
- older/after는 count 제한과 48KiB envelope 제한을 동시에 지킨다.
- 단일 저장 row가 envelope 제한을 넘으면 skip, truncate, cursor advance를 하지 않고 data-integrity failure로 중단한다.

## Client merge

- latest, older, after, live event, accepted 결과는 sequence-aware merge model을 사용한다.
- 중복 message/sequence는 한 번만 적용한다.
- cursor 이하이면서 현재 window 밖인 delayed event는 현재 tail에 삽입하지 않는다.
- channel timeline에 thread reply 본문이나 `threadSummary`를 넣지 않는다.
