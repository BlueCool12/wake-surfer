# 메모

이 package 구조는 기존 `packages/realtime-chat-api`, `packages/realtime-chat-gateway` 분리를 합쳐 `packages/realtime-chat` 하나가 feature 구현을 소유하도록 바꾼 결과입니다.

기존 package-owned split 검토 문서는 `docs/realtime-chat-package-owned-docs/`에 배경 자료로 남아 있습니다. 이 notes는 agent context route가 아닙니다. coding task에서 의존해야 하는 현재 구현 제약은 먼저 `public-docs/` 또는 `owner-docs/`로 승격해야 합니다.
