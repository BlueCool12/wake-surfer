import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  DeleteMessageResponse,
  EditMessageResponse,
} from "@wake-surfer/realtime-chat-message-mutation-contracts";
import type { SendMessageResponse } from "@wake-surfer/realtime-chat-message-send-contracts";

type AcceptedSendMessageResponse = Extract<SendMessageResponse, { status: "accepted" }>;

export type RealtimeChatMessageAcceptedResponse = Omit<AcceptedSendMessageResponse, "message"> & {
  message: PublicMessage;
};

export type RealtimeChatMessageRejectedResponse = Extract<
  SendMessageResponse,
  { status: "rejected" }
>;

export interface RealtimeChatMessageTransport {
  connect(): Promise<void>;
  deleteMessage(params: { messageId: string }): void;
  disconnect(): void;
  editMessage(params: { messageId: string; text: string }): void;
  isReady(): boolean;
  sendMessage(params: { idempotencyKey: string; text: string }): void;
  onConnectionGenerationChanged(listener: (connectionGeneration: string) => void): () => void;
  onDisconnected(listener: () => void): () => void;
  onMessageCreated(listener: (message: PublicMessage) => void): () => void;
  onMessageAccepted(listener: (response: RealtimeChatMessageAcceptedResponse) => void): () => void;
  onMessageDeleteResult(listener: (response: DeleteMessageResponse) => void): () => void;
  onMessageEditResult(listener: (response: EditMessageResponse) => void): () => void;
  onMessageRejected(listener: (response: RealtimeChatMessageRejectedResponse) => void): () => void;
}
