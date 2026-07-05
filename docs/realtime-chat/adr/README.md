# realtime-chat ADR

Realtime chat feature의 구조와 의존성 결정을 기록하는 ADR 모음입니다.

## 작성 규칙

ADR은 한 번 작성되면 불변으로 취급합니다.

- 기존 ADR의 본문을 수정하지 않습니다.
- 기존 ADR 파일을 삭제하지 않습니다.
- 결정 변경, 보완, 폐기는 새 ADR을 추가해서 기록합니다.
- 기존 ADR에 추가 설명이 필요하면 새 ADR을 작성합니다.
- 단, 상충/대체 관계를 표시하기 위한 `후속 ADR` 섹션 추가는 허용합니다.
- 파일명과 번호는 재사용하지 않습니다.

## 상충/대체 관계 참조 규칙

새 ADR이 이전 ADR의 결정과 상충하거나 이전 결정을 대체하는 경우, 양쪽 문서가 서로를 참조해야 합니다.

새 ADR은 `관련 ADR` 항목에 기존 ADR을 링크합니다. 예: [ADR 001. realtime-chat package boundary 결정](./001-package-boundary.md)

기존 ADR은 파일 최상단에 `## 후속 ADR` 섹션을 추가하고, 새 ADR 파일이 생성된 뒤 실제 ADR 링크를 추가합니다.

이 참조는 양방향으로 유지합니다. 기존 본문은 고치지 않고, 후속 ADR 섹션만 추가합니다.

## 목록 확장 기준

ADR이 많아져 현재 문서 테이블만으로 찾기 어려워지면 축별 목록 문서를 추가합니다.

- ADR 원문은 번호가 붙은 기존 파일 위치에 둡니다.
- 축별 목록 문서는 ADR 원문을 복제하지 않고 링크, 상태, 짧은 요약만 둡니다.
- 축 예시는 패키지 경계, 런타임 의존성, 데이터베이스, 테스트 전략입니다.

## 현재 문서

| ADR                                                                             | 축            | 상태     | 날짜       |
| ------------------------------------------------------------------------------- | ------------- | -------- | ---------- |
| [ADR 001. realtime-chat package boundary 결정](./001-package-boundary.md)       | 패키지 경계   | Accepted | 2026-07-04 |
| [ADR 002. realtime-chat runtime dependency 선택](./002-runtime-dependencies.md) | 런타임 의존성 | Accepted | 2026-07-04 |
| [ADR 003. realtime-chat 개발 DB 방향](./003-development-database.md)            | 데이터베이스  | Accepted | 2026-07-04 |
| [ADR 004. realtime-chat 테스트 전략](./004-testing-strategy.md)                 | 테스트 전략   | Accepted | 2026-07-04 |
