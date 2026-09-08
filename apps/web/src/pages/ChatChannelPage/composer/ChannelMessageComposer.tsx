import { useEffect, useRef, useState } from "react";

import type { ChannelMember } from "../thread/ThreadPanelView";
import { createChatComposerSubmitController } from "./chatComposerKeyPolicy";
import { MessageComposerView } from "./MessageComposerView";

/** 커서 바로 앞에서 진행 중인 "@닉네임" 멘션 입력을 찾는다. 공백/줄바꿈이 나오면 멘션 입력이 끝난 것으로 본다. */
function findMentionQuery(value: string, cursor: number): string | undefined {
  const beforeCursor = value.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
  return match?.[1];
}

// 입력 상태와 브라우저 조작은 입력 기능이 소유하고, 메시지 전송은 콜백으로 요청한다.
// 채널 변경 시 초안 유지 여부는 기존 동작을 따른다. 채널별 보관 정책은 별도로 정한다.
export function ChannelMessageComposer({
  placeholder,
  members,
  onSend,
}: {
  placeholder: string;
  members: ChannelMember[];
  onSend: (text: string) => void;
}) {
  // 상태: 작성 중인 입력 내용. 처음에는 빈 문자열이며, 입력 시 갱신하고 전송 후 비운다.
  const [draft, setDraft] = useState("");
  // 참조: 실제 입력창 요소. 리액트가 연결/해제하며, 높이 측정·초점·커서 위치 조작에 사용한다.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 참조: 한글 조합 중인지와 Enter 전송 대기 여부를 기억하는 제어 객체를 유지한다.
  // 주의: 인자의 생성 함수는 매 렌더링마다 실행되지만, 초기화 이후 만든 객체는 useRef가 저장하지 않는다.
  const submitControllerRef = useRef(createChatComposerSubmitController());
  // 상태: 입력창이 여러 줄 높이인지 기억한다. 처음에는 false이며, draft 변경 후 높이를 측정해 갱신한다.
  const [isDraftMultiline, setIsDraftMultiline] = useState(false);
  // 참조: 최초 측정한 한 줄 높이. 처음에는 undefined이며, 한 번 기록한 높이를 이후 비교에 사용한다.
  const singleLineHeightRef = useRef<number | undefined>(undefined);

  // "@"로 멘션할 멤버를 고르는 팝업. 백엔드에 멘션 개념이 없어 텍스트에 이름을 끼워 넣는 UI만 구현한다.
  // 상태: 커서 앞의 멘션 검색어. undefined로 시작하며, 멘션 선택·전송·멘션 Escape 처리 시 지운다.
  const [mentionQuery, setMentionQuery] = useState<string | undefined>(undefined);
  // 상태: 키보드로 선택 중인 멘션 후보의 위치. 0으로 시작하며, 입력 변경 시 0으로 되돌린다.
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  // 계산값: 현재 검색어로 매 렌더링마다 새 배열을 만든다. 리액트에 따로 보관하는 상태가 아니다.
  const mentionMatches =
    mentionQuery === undefined
      ? []
      : members.filter((member) =>
          member.name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
        );
  // 계산값: 검색어와 후보 목록으로 매 렌더링마다 팝업 표시 여부를 구한다.
  const isMentionOpen = mentionQuery !== undefined && mentionMatches.length > 0;

  // 입력 내용에 따라 textarea 높이를 늘린다(최대 높이는 CSS max-height 가 제한).
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    // 첫 측정은 빈 입력이라 한 줄 높이다.
    singleLineHeightRef.current ??= el.scrollHeight;
    el.style.height = `${el.scrollHeight}px`;
    setIsDraftMultiline(el.scrollHeight > singleLineHeightRef.current);
  }, [draft]);

  const handleSend = (text: string) => {
    submitControllerRef.current.cancelPendingSubmit();
    if (text.trim() === "") return;
    onSend(text);
    setDraft("");
    setMentionQuery(undefined);
  };

  const handleDraftChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft(value);
    setMentionQuery(findMentionQuery(value, event.target.selectionStart));
    setMentionActiveIndex(0);
  };

  const handleSelectMention = (member: ChannelMember) => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor).replace(/@([^\s@]*)$/, `@${member.name} `);
    const after = draft.slice(cursor);
    setDraft(before + after);
    setMentionQuery(undefined);

    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const submitController = submitControllerRef.current;

    if (isMentionOpen) {
      if (submitController.isImeProcessing(event.nativeEvent)) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index + 1) % mentionMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionActiveIndex(
          (index) => (index - 1 + mentionMatches.length) % mentionMatches.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const activeMember = mentionMatches[mentionActiveIndex];
        if (activeMember !== undefined) handleSelectMention(activeMember);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionQuery(undefined);
        return;
      }
    }

    const result = submitController.handleKeyDown(event.nativeEvent);
    if (result.shouldPreventDefault) event.preventDefault();
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!submitControllerRef.current.consumeSubmitOnKeyUp(event.nativeEvent)) return;
    handleSend(event.currentTarget.value);
  };

  return (
    <MessageComposerView
      placeholder={placeholder}
      draft={draft}
      isDraftMultiline={isDraftMultiline}
      canSend={draft.trim() !== ""}
      textareaRef={textareaRef}
      mentionPicker={
        isMentionOpen
          ? {
              members: mentionMatches,
              activeIndex: mentionActiveIndex,
              onSelect: handleSelectMention,
            }
          : undefined
      }
      onChange={handleDraftChange}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onCompositionStart={() => submitControllerRef.current.compositionStarted()}
      onCompositionEnd={() => submitControllerRef.current.compositionEnded()}
      onBlur={() => submitControllerRef.current.cancelPendingSubmit()}
      onSend={() => handleSend(draft)}
    />
  );
}
