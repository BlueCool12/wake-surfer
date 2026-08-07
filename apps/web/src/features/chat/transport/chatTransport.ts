import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type { SendMessageResponse } from "@wake-surfer/realtime-chat-message-send-contracts";
import type { StreamMessagesTransport } from "@wake-surfer/realtime-chat-stream-messages-client";

type AcceptedSendMessageResponse = Extract<SendMessageResponse, { status: "accepted" }>;

export type MessageAcceptedResponse = Omit<AcceptedSendMessageResponse, "message"> & {
  message: PublicMessage;
};
export type MessageRejectedResponse = Extract<SendMessageResponse, { status: "rejected" }>;

export interface ChatMessageTransport {
  connect(): Promise<void>;
  disconnect(): void;
  isReady(): boolean;
  sendChannelMessage(params: { idempotencyKey: string; text: string }): void;
  onConnectionGenerationChanged(listener: (connectionGeneration: string) => void): () => void;
  onDisconnected(listener: () => void): () => void;
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
