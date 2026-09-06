import type { ChannelMember } from "./ThreadPanel";
import styles from "./MentionPicker.module.css";

type MentionPickerProps = {
  members: ChannelMember[];
  activeIndex: number;
  onSelect: (member: ChannelMember) => void;
};

/** "@"로 멘션할 채팅방 멤버를 고르는 팝업. 입력창 바로 위에 뜬다. */
function MentionPicker({ members, activeIndex, onSelect }: MentionPickerProps) {
  return (
    <ul className={styles.list} role="listbox">
      {members.map((member, index) => (
        <li key={member.id} role="option" aria-selected={index === activeIndex}>
          <button
            type="button"
            className={index === activeIndex ? `${styles.item} ${styles.itemActive}` : styles.item}
            // 버튼 클릭으로 textarea가 blur되기 전에 선택을 확정하기 위해 mousedown에서 처리한다.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(member);
            }}
          >
            <span className={styles.avatar} aria-hidden="true">
              {member.name.slice(0, 1)}
            </span>
            <span className={styles.name}>{member.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default MentionPicker;
