import type { ComponentProps, RefObject } from "react";
import { Send } from "lucide-react";

import MentionPickerView from "./MentionPickerView";
import styles from "../ChatChannelPage.module.css";

type MessageComposerViewProps = {
  placeholder: string;
  draft: string;
  isDraftMultiline: boolean;
  canSend: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mentionPicker: ComponentProps<typeof MentionPickerView> | undefined;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onKeyUp: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onBlur: () => void;
  onSend: () => void;
};

// 입력창·멘션 목록·전송 버튼의 표시와 요소·이벤트 연결을 담당한다.
// 입력 상태와 브라우저 조작은 ChannelMessageComposer가 연결하고, 전송은 외부 콜백으로 요청한다.
export function MessageComposerView({
  placeholder,
  draft,
  isDraftMultiline,
  canSend,
  textareaRef,
  mentionPicker,
  onChange,
  onKeyDown,
  onKeyUp,
  onCompositionStart,
  onCompositionEnd,
  onBlur,
  onSend,
}: MessageComposerViewProps) {
  return (
    <div className={styles.composer}>
      {mentionPicker !== undefined ? <MentionPickerView {...mentionPicker} /> : null}
      <div
        className={
          isDraftMultiline ? `${styles.inputWrap} ${styles.inputWrapMultiline}` : styles.inputWrap
        }
      >
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={1}
        />
        <button
          type="button"
          className={styles.sendButton}
          onClick={onSend}
          disabled={!canSend}
          aria-label="전송"
        >
          <Send size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
