<!-- 제목은 Conventional Commits 형식 권장: <type>(<scope>): <subject> -->

## 관련 이슈

<!-- 예: Closes #12  (이슈 없는 PR은 지양) -->

Closes #

## Stack (해당 시)

<!--
일반 PR이면 이 절을 삭제한다.
stacked PR이면 선행 PR마다 아래 형식을 한 줄씩 작성한다.

Depends on #123
-->

## 변경 요약

<!-- 무엇을, 왜 변경했는지 -->

## 테스트

<!-- 어떻게 검증했는지. dev 머지 전 충분히 테스트 -->

- [ ] 로컬에서 동작 확인
- [ ] 테스트 추가/갱신 (해당 시)

## 체크리스트

- [ ] 일반 PR은 base가 `dev`, stacked PR은 base가 선행 PR의 head인지 확인
- [ ] stacked PR은 선행 PR 머지 후 base를 `dev`로 변경
- [ ] 린트 / 빌드 통과
- [ ] 리뷰어가 이해할 수 있게 설명/스크린샷 첨부 (필요 시)
