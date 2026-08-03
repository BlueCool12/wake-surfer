import type {
  OutboundMessageDeliveryRequested,
  SendMessageTarget,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import type { Kysely } from "kysely";
import {
  assertSendMessageTarget,
  createDefaultMessageIdGenerator,
  createDefaultOutboundEventIdGenerator,
  getSendMessageStreamId,
} from "./message-send";
import type {
  MessageIdGenerator,
  OutboundEventIdGenerator,
  SendMessageInput,
  SendMessageResult,
} from "./message-send";
import type { MessageSendDatabase } from "./message-send-table";
import {
  appendTextMessage,
  findAppendedTextMessageByIdempotencyKey,
} from "./usecases/send-message/send-message.kysely";
import { sendMessage } from "./usecases/send-message/send-message.usecase";

export type MessageTargetResolution =
  | {
      status: "resolved";
      streamId: string;
      recipientActorIds: string[];
    }
  | {
      status: "rejected";
      reason: "target_not_found";
    };

export type MessageTargetResolver = (input: {
  senderActorId: string;
  target: SendMessageTarget;
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
  target: SendMessageTarget;
  streamId: string;
}) => MessageWriteAuthorization | Promise<MessageWriteAuthorization>;

export type OutboundDeliveryPublisher = (
  event: OutboundMessageDeliveryRequested,
) => void | Promise<void>;

export type CreateMessageSendModuleConfig<DB extends MessageSendDatabase = MessageSendDatabase> = {
  db: Kysely<DB>;
  authorizeWrite: MessageWriteAuthorizer;
  resolveTarget?: MessageTargetResolver;
  publishDeliveryRequested?: OutboundDeliveryPublisher;
  messageIdGenerator?: MessageIdGenerator;
  outboundEventIdGenerator?: OutboundEventIdGenerator;
  now?: () => Date;
};

export type MessageSendModule = {
  send: (input: SendMessageInput) => Promise<SendMessageResult>;
};

export function createDefaultMessageTargetResolver(): MessageTargetResolver {
  return ({ target }) => {
    assertSendMessageTarget(target);

    return {
      status: "resolved",
      streamId: getSendMessageStreamId(target),
      recipientActorIds: [],
    };
  };
}

export function createMessageSendModule<DB extends MessageSendDatabase = MessageSendDatabase>(
  config: CreateMessageSendModuleConfig<DB>,
): MessageSendModule {
  const db = config.db as Kysely<MessageSendDatabase>;
  const resolveTarget = config.resolveTarget ?? createDefaultMessageTargetResolver();
  const messageIdGenerator = config.messageIdGenerator ?? createDefaultMessageIdGenerator();
  const outboundEventIdGenerator =
    config.outboundEventIdGenerator ?? createDefaultOutboundEventIdGenerator();
  const now = config.now ?? createNow;

  return {
    send(input) {
      const deps = {
        db,
        now,
        resolveTarget,
        authorizeWrite: config.authorizeWrite,
        messageIdGenerator,
        outboundEventIdGenerator,
        findAppendedTextMessageByIdempotencyKey,
        appendTextMessage,
      };

      if (config.publishDeliveryRequested !== undefined) {
        return sendMessage(input, {
          ...deps,
          publishDeliveryRequested: config.publishDeliveryRequested,
        });
      }

      return sendMessage(input, deps);
    },
  };
}

function createNow(): Date {
  return new Date();
}
