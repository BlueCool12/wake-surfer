import type {
  MessageAcceptedResponse,
  MessageRejectedResponse,
  PublicMessageDto,
  UserId,
} from "../contracts";
import type { ChatTransport, ChatTransportContext } from "./chatTransport";

/** 목 환경에서 "나"로 간주할 사용자 id. 실제로는 인증(actorId)에서 온다. */
export const MOCK_ME: UserId = "user-me";
const MOCK_OTHER: UserId = "user-wave";

type Listener<T> = (value: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(value: T): void {
      for (const listener of listeners) listener(value);
    },
  };
}

/**
 * 백엔드 없이 채팅방 화면을 구동하기 위한 인메모리 구현.
 * 히스토리를 시드하고, 보낸 메시지를 짧은 지연 후 accepted → created 로 에코한다.
 * 실제 소켓 구현으로 교체될 자리 표시자다.
 */
export function createMockChatTransport(context: ChatTransportContext): ChatTransport {
  const created = createEmitter<PublicMessageDto>();
  const accepted = createEmitter<MessageAcceptedResponse>();
  const rejected = createEmitter<MessageRejectedResponse>();

  const streamId = `stream-${context.channelId}`;
  let sequence = 0;
  const nextSequence = () => (sequence += 1);

  const history: PublicMessageDto[] = [
    {
      messageId: "m1",
      streamId,
      streamType: "CHANNEL",
      sequence: nextSequence(),
      senderId: MOCK_OTHER,
      messageType: "USER",
      content: { kind: "text", text: "안녕하세요! 실시간 채팅 목업이에요 👋" },
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    },
    {
      messageId: "m2",
      streamId,
      streamType: "CHANNEL",
      sequence: nextSequence(),
      senderId: MOCK_ME,
      messageType: "USER",
      content: { kind: "text", text: "네, 아래 입력창으로 보내보면 에코로 답이 와요." },
      createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    },
  ];

  return {
    async connect() {
      // 실제 구현: 티켓 발급 + 소켓 연결 + gateway.connected 대기.
    },

    disconnect() {
      // 실제 구현: 소켓 close.
    },

    async loadHistory() {
      return [...history];
    },

    sendChannelMessage({ clientMessageId, content }) {
      // 수락 응답 (낙관적 항목 확정)
      window.setTimeout(() => {
        const messageId = `m-${crypto.randomUUID()}`;
        const seq = nextSequence();
        const serverCreatedAt = new Date().toISOString();

        accepted.emit({
          status: "accepted",
          commandId: crypto.randomUUID(),
          clientMessageId,
          messageId,
          streamId,
          streamType: "CHANNEL",
          sequence: seq,
          serverCreatedAt,
        });

        created.emit({
          messageId,
          streamId,
          streamType: "CHANNEL",
          sequence: seq,
          senderId: MOCK_ME,
          messageType: "USER",
          content,
          createdAt: serverCreatedAt,
        });

        // 상대방이 답하는 것처럼 에코
        window.setTimeout(() => {
          created.emit({
            messageId: `m-${crypto.randomUUID()}`,
            streamId,
            streamType: "CHANNEL",
            sequence: nextSequence(),
            senderId: MOCK_OTHER,
            messageType: "USER",
            content: { kind: "text", text: `“${content.text}” 잘 받았어요!` },
            createdAt: new Date().toISOString(),
          });
        }, 700);
      }, 250);
    },

    onMessageCreated: created.subscribe,
    onMessageAccepted: accepted.subscribe,
    onMessageRejected: rejected.subscribe,
  };
}
