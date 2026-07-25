import type {
  PublicMessage,
  TextMessageContent,
} from "@wake-surfer/realtime-chat-message-contracts";
import type { SendMessageResponse } from "@wake-surfer/realtime-chat-message-send-contracts";
import type { StreamMessagesTransport } from "@wake-surfer/realtime-chat-stream-messages-client";

export type MessageAcceptedResponse = Extract<SendMessageResponse, { status: "accepted" }>;
export type MessageRejectedResponse = Extract<SendMessageResponse, { status: "rejected" }>;

export interface ChatMessageTransport {
  connect(): Promise<void>;
  disconnect(): void;
  sendChannelMessage(params: { clientMessageId: string; content: TextMessageContent }): void;
  onMessageCreated(listener: (message: PublicMessage) => void): () => void;
  onMessageAccepted(listener: (response: MessageAcceptedResponse) => void): () => void;
  onMessageRejected(listener: (response: MessageRejectedResponse) => void): () => void;
}

export type ChatRoomRuntime = {
  messageTransport: ChatMessageTransport;
  streamMessagesTransport: StreamMessagesTransport;
};

export type ChatRoomRuntimeContext = {
  actorId: string;
  channelId: string;
};

export type ChatRoomRuntimeFactory = (context: ChatRoomRuntimeContext) => ChatRoomRuntime;
