import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ChannelId,
  ClientMessageId,
  MessageType,
  PublicMessageDto,
  UserId,
} from "./contracts";
import type { ChatTransport } from "./transport/chatTransport";
import { createMockChatTransport, MOCK_ME } from "./transport/mockChatTransport";

// 채팅 브랜치 머지 후 타입 정리 필요
export type ChatMessageStatus = "pending" | "sent" | "failed";

export type ChatMessageView = {
  key: string;
  clientMessageId?: ClientMessageId;
  messageId?: string;
  sequence?: number;
  senderId?: UserId | undefined;
  isMine: boolean;
  messageType: MessageType;
  text: string;
  createdAt: string;
  status: ChatMessageStatus;
};

function toView(message: PublicMessageDto, meId: UserId): ChatMessageView {
  return {
    key: message.messageId,
    messageId: message.messageId,
    sequence: message.sequence,
    senderId: message.senderId,
    isMine: message.senderId === meId,
    messageType: message.messageType,
    text: message.content.text,
    createdAt: message.createdAt,
    status: "sent",
  };
}

export type UseChatRoomResult = {
  messages: ChatMessageView[];
  isLoading: boolean;
  sendMessage: (text: string) => void;
  retryMessage: (message: ChatMessageView) => void;
};

/**
 * 채팅방 하나의 실시간 상태를 관리한다.
 * 지금은 목 트랜스포트를 쓰지만, 이 훅 밖의 화면 코드는 트랜스포트 종류를 모른다.
 * 실제 소켓이 붙으면 아래 createMockChatTransport 한 줄만 교체하면 된다.
 */
export function useChatRoom(channelId: ChannelId, meId: UserId = MOCK_ME): UseChatRoomResult {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const transportRef = useRef<ChatTransport | null>(null);

  useEffect(() => {
    let active = true;
    const transport = createMockChatTransport({ channelId });
    transportRef.current = transport;

    const appendCreated = (message: PublicMessageDto) => {
      setMessages((prev) => {
        // messageId 중복이면 무시(내 메시지는 accepted가 이미 확정해 둠).
        if (prev.some((m) => m.messageId === message.messageId)) return prev;
        return [...prev, toView(message, meId)];
      });
    };

    const unsubscribers = [
      transport.onMessageCreated(appendCreated),
      transport.onMessageAccepted((res) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === res.clientMessageId
              ? {
                  ...m,
                  key: res.messageId,
                  messageId: res.messageId,
                  sequence: res.sequence,
                  createdAt: res.serverCreatedAt,
                  status: "sent",
                }
              : m,
          ),
        );
      }),
      transport.onMessageRejected((res) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === res.clientMessageId ? { ...m, status: "failed" } : m,
          ),
        );
      }),
    ];

    void transport.connect().then(async () => {
      const history = await transport.loadHistory();
      if (!active) return;
      setMessages(history.map((message) => toView(message, meId)));
      setIsLoading(false);
    });

    return () => {
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
      transport.disconnect();
      transportRef.current = null;
    };
  }, [channelId, meId]);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    const transport = transportRef.current;
    if (trimmed === "" || transport === null) return;

    const clientMessageId = crypto.randomUUID();
    const optimistic: ChatMessageView = {
      key: clientMessageId,
      clientMessageId,
      isMine: true,
      messageType: "USER",
      text: trimmed,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setMessages((prev) => [...prev, optimistic]);

    transport.sendChannelMessage({
      clientMessageId,
      content: { kind: "text", text: trimmed },
    });
  }, []);

  const retryMessage = useCallback((message: ChatMessageView) => {
    const transport = transportRef.current;
    // 실패한 낙관적 항목만 재시도한다. 같은 clientMessageId 로 다시 보내
    // accepted/rejected 정합이 그대로 이어진다.
    if (transport === null || message.clientMessageId === undefined) return;

    const { clientMessageId, text } = message;
    setMessages((prev) =>
      prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, status: "pending" } : m)),
    );

    transport.sendChannelMessage({
      clientMessageId,
      content: { kind: "text", text },
    });
  }, []);

  return { messages, isLoading, sendMessage, retryMessage };
}
