import type { ComponentProps } from "react";

import MessageBubbleView from "./MessageBubbleView";
import styles from "../ChatChannelPage.module.css";

export function MessageItemsView({ items }: { items: ComponentProps<typeof MessageBubbleView>[] }) {
  if (items.length === 0) {
    return <p className={styles.placeholder}>아직 잔잔해요. 첫 파도를 일으켜보세요 🌊</p>;
  }

  return items.map((item) => <MessageBubbleView key={item.message.key} {...item} />);
}
