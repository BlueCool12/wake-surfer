import type { MessageTarget } from "@wake-surfer/realtime-chat-message-send-contracts";
import type { Kysely } from "kysely";
import type { MessageSendDatabase } from "./message-send-table";

export type SenderScopedIdempotencyKey = Readonly<{
  senderActorId: string;
  idempotencyKey: string;
}>;

export type SendMessageInput = SenderScopedIdempotencyKey &
  Readonly<{
    target: MessageTarget;
    text: string;
  }>;

export type AppendedTextMessage = Readonly<{
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
  target: MessageTarget;
  text: string;
  createdAt: Date;
}>;

export type SendMessageResult =
  | {
      status: "accepted";
      persistence: "created" | "existing";
      message: AppendedTextMessage;
    }
  | {
      status: "rejected";
      reason: "invalid_text" | "target_not_found" | "write_forbidden" | "idempotency_conflict";
    };

export type SendMessage = (input: SendMessageInput) => Promise<SendMessageResult>;

export type MessageTargetResolution =
  | {
      status: "resolved";
      streamId: string;
    }
  | {
      status: "rejected";
      reason: "target_not_found";
    };

export type MessageTargetResolver = (input: {
  senderActorId: string;
  target: MessageTarget;
}) => MessageTargetResolution | Promise<MessageTargetResolution>;

export type MessageWriteAuthorization =
  | {
      status: "allowed";
    }
  | {
      status: "denied";
    };

export type MessageWriteAuthorizer = (input: {
  senderActorId: string;
  target: MessageTarget;
  streamId: string;
}) => MessageWriteAuthorization | Promise<MessageWriteAuthorization>;

export type SendMessageDependencies<DB extends MessageSendDatabase = MessageSendDatabase> = {
  db: Kysely<DB>;
  authorizeWrite: MessageWriteAuthorizer;
  resolveTarget: MessageTargetResolver;
  generateMessageId?: () => string;
};
