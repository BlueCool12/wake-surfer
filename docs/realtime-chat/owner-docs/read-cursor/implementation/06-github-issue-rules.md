# Read Cursor 구현 계획: GitHub 이슈 생성 규칙

> [구현 index](./README.md) | [설계 index](../design/README.md)

`RCI-*` 순서를 GitHub 번호로 강제하지 않는다. 실제 이슈 제목에는 계획 ID를 남긴다.

```txt
[RCI-03] Mark Read Cursor Command 구현
```

각 이슈 본문에는 최소 다음을 포함한다.

- 해당 `RCI-*` 문서와 관련 Accepted 설계 링크
- 목표와 비범위
- 직접 선행 GitHub 이슈 번호
- 변경 package/app
- 완료 조건 체크리스트
- 검증 명령
- 후속 PR의 `Closes #...`

이슈 assignee는 `yullraes`, PR reviewer는 `BlueCool12`, `chan0324`로 지정한다. 브랜치는
`<type>/<issue#>-<slug>` 형식을 사용한다.

이슈 생성 뒤 계획 ID와 실제 번호의 대응표를 이 문서에 추가한다. 새 작업이 발견되면 기존 이슈를
무제한 확장하지 않는다. 설계 의미를 바꾸지 않는 작업은 별도 이슈로 분리하고, 의미를 바꾸는 작업은 먼저
Accepted 결정문을 개정한다.

## 계획 ID와 GitHub 이슈 대응표

| 계획 ID | GitHub 이슈 | 상태 |
| --- | --- | --- |
| RCI-01~RCI-15 | 미생성 | 계획 완료 |
