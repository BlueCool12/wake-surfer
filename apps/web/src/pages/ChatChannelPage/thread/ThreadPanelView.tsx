import type { ReactNode } from "react";
import { MessagesSquare, PanelRightClose, StickyNote, Users } from "lucide-react";
import type { ChannelMember } from "../channelMember";
import styles from "./ThreadPanelView.module.css";
export type ThreadPanelTab = "thread" | "members" | "memo";
export type ThreadPanelViewProps = {
  className?: string | undefined;
  onClose: () => void;
  activeTab: ThreadPanelTab;
  onTabChange: (tab: ThreadPanelTab) => void;
  members: readonly ChannelMember[];
  isCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  thread: ReactNode;
};

/** 선택된 본문은 껍데기와 독립적으로 유지하며, 탭과 접힘은 표시만 바꾼다. */
export default function ThreadPanelView({
  className,
  onClose,
  activeTab,
  onTabChange,
  members,
  isCollapsed,
  onCollapsedChange,
  thread,
}: ThreadPanelViewProps) {
  const panelClass = className === undefined ? styles.panel : `${styles.panel} ${className}`;
  return (
    <aside className={panelClass}>
      {isCollapsed ? (
        <div className={styles.rail}>
          <button
            type="button"
            className={styles.tab}
            onClick={() => {
              onCollapsedChange(false);
              onTabChange("thread");
            }}
            aria-label="스레드 패널 펼치기"
          >
            <MessagesSquare size={16} />
            <span className={styles.tooltip}>스레드</span>
          </button>
          <button
            type="button"
            className={styles.tab}
            onClick={() => {
              onCollapsedChange(false);
              onTabChange("memo");
            }}
            aria-label="메모 패널 펼치기"
          >
            <StickyNote size={16} />
            <span className={styles.tooltip}>메모</span>
          </button>
          <button
            type="button"
            className={styles.tab}
            onClick={() => {
              onCollapsedChange(false);
              onTabChange("members");
            }}
            aria-label="멤버 패널 펼치기"
          >
            <Users size={16} />
            <span className={styles.tooltip}>멤버</span>
          </button>
        </div>
      ) : (
        <div className={styles.tabs}>
          <button
            type="button"
            className={activeTab === "thread" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => onTabChange("thread")}
            aria-label="스레드"
          >
            <MessagesSquare size={16} />
            <span className={styles.tooltip}>스레드</span>
          </button>
          <button
            type="button"
            className={activeTab === "memo" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => onTabChange("memo")}
            aria-label="메모"
          >
            <StickyNote size={16} />
            <span className={styles.tooltip}>메모</span>
          </button>
          <button
            type="button"
            className={activeTab === "members" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => onTabChange("members")}
            aria-label="멤버"
          >
            <Users size={16} />
            <span className={styles.tooltip}>멤버</span>
          </button>

          <button
            type="button"
            className={`${styles.tab} ${styles.tabsEnd} ${styles.collapseButton}`}
            onClick={() => onCollapsedChange(true)}
            aria-label="패널 접기"
          >
            <PanelRightClose size={16} />
            <span className={styles.tooltip}>접기</span>
          </button>

          <button
            type="button"
            className={`${styles.tab} ${styles.tabsEnd} ${styles.closeButton}`}
            onClick={onClose}
            aria-label="패널 닫기"
          >
            <PanelRightClose size={16} />
          </button>
        </div>
      )}
      {!isCollapsed ? (
        <>
          {activeTab === "members" ? (
            <div className={styles.memberList}>
              {[
                { label: "온라인", members: members.filter((member) => member.isOnline) },
                { label: "오프라인", members: members.filter((member) => !member.isOnline) },
              ].map((group) =>
                group.members.length === 0 ? null : (
                  <div key={group.label} className={styles.memberGroup}>
                    <p className={styles.memberGroupLabel}>
                      {group.label} {group.members.length}
                    </p>
                    <ul className={styles.memberGroupList}>
                      {group.members.map((member) => (
                        <li key={member.id} className={styles.member}>
                          <span className={styles.memberAvatarWrap}>
                            <span className={styles.memberAvatar} aria-hidden="true">
                              {member.name.slice(0, 1)}
                            </span>
                            <span
                              className={
                                member.isOnline
                                  ? `${styles.memberStatusDot} ${styles.memberStatusDotOnline}`
                                  : styles.memberStatusDot
                              }
                              aria-hidden="true"
                            />
                          </span>
                          <span
                            className={
                              member.isOnline
                                ? styles.memberName
                                : `${styles.memberName} ${styles.memberNameOffline}`
                            }
                          >
                            {member.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          ) : activeTab === "memo" ? (
            <div className={styles.emptyState}>
              <p>메모 기능은 아직 준비 중이에요.</p>
            </div>
          ) : null}
        </>
      ) : null}
      {thread}
    </aside>
  );
}
