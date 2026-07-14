# Stream Messages 구현 계획: GitHub 이슈 생성 규칙

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 11. 실제 GitHub 이슈 생성 규칙

이 문서의 `SMI-*`, `DEP-*` 순서를 GitHub 번호로 강제하지 않는다. 실제 이슈 제목에는 계획 ID를 남겨
추적한다.

예시:

```txt
[SMI-07] Latest Stream Messages Query 구현
```

각 이슈 본문에는 최소 다음을 포함한다.

- 이 문서와 Accepted 설계 문서 링크
- 목표와 비범위
- 선행 GitHub 이슈 번호
- 변경 package/app
- 완료 조건 체크리스트
- 검증 명령
- `Refs #...` 또는 후속 PR의 `Closes #...`

이슈 생성 뒤 계획 ID와 실제 번호의 대응표를 이 문서에 추가한다. 구현 중 새 작업이 발견되면 기존 이슈를
무제한 확장하지 않고, 설계 의미를 바꾸지 않는 범위에서 별도 이슈로 분리한다. 설계 의미 자체를 바꿔야
하면 먼저 Accepted 결정문을 개정한다.
