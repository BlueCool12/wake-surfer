# RCI-09 Web read observation 상태 모델 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-01](./RCI-01.md)
- [SMI-13 Web merge model](../../stream-messages/issues/SMI-13.md)

### 관련 설계

- [Mark 의미](../design/03-mark-semantics.md)
- [Unread와 client state](../design/07-unread-and-client-state.md)
- [Acceptance criteria](../design/09-acceptance-and-non-goals.md)

## 작업 정의

**목표**

transport와 UI framework에서 분리된 순수 Web 상태 모델로 “언제 어디까지 mark할 수 있는가”를 계산한다.

**주요 변경**

- active channel과 document/app visibility 입력
- latest baseline merge/render 완료 signal
- gap 없는 최대 연속 applied sequence 추적
- pending mark의 최대 sequence 병합과 debounce state
- server effective cursor와 `hasUnread` 상태

**완료 조건**

- inactive/hidden/merge 전에는 mark intent를 만들지 않는다.
- latest 최대 5개가 merge/render되면 `throughSequence`를 baseline으로 만든다.
- 100 뒤 102를 먼저 받으면 102를 mark하지 않고 101 merge 뒤 102를 허용한다.
- older pagination이 mark 위치를 역행시키지 않는다.
- pending 100/120을 하나의 120 intent로 합친다.
- Stream Messages delivery/history cursor와 상태를 공유하지 않는다.
- transport 없이 reducer/store test가 실행된다.

**비범위**

- HTTP/WS 호출
- viewport별 message visibility
- unread badge UI

권장 브랜치 slug: `chat-read-observation-model`
