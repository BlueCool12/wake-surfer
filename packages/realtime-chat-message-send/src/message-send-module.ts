import type {
  ActorId,
  ClientMessageId,
  CommandId,
  ISODateTime,
  OutboundMessageDeliveryRequested,
  SendMessageContent,
  SendMessageResponse,
  SendMessageTarget,
  StreamId,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import { getCanonicalStreamId } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";
import {
  assertMessageTarget,
  createDefaultMessageIdGenerator,
  createDefaultOutboundEventIdGenerator,
} from "./message-send";
import type { MessageIdGenerator, OutboundEventIdGenerator } from "./message-send";
import type { MessageSendDatabase } from "./message-send-table";
import {
  appendMessage,
  findAcceptedMessageByClientMessageId,
} from "./usecases/send-message/send-message.kysely";
import { sendMessage } from "./usecases/send-message/send-message.usecase";

export type SendMessageContext = {
  actorId: ActorId;
};

export type SendMessageCommand = {
  commandId?: CommandId;
  clientMessageId: ClientMessageId;
  target: SendMessageTarget;
  content: SendMessageContent;
  sentAtClient?: ISODateTime;
};

export type MessageTargetResolution =
  | {
      status: "resolved";
      streamId: StreamId;
      recipientActorIds: ActorId[];
    }
  | {
      status: "rejected";
      reason: "target_not_found";
    };

export type MessageTargetResolver = (input: {
  actorId: ActorId;
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
  actorId: ActorId;
  target: SendMessageTarget;
  streamId: StreamId;
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
  send: (command: SendMessageCommand, context: SendMessageContext) => Promise<SendMessageResponse>;
};

export function createDefaultMessageTargetResolver(): MessageTargetResolver {
  return ({ target }) => {
    assertMessageTarget(target);

    return {
      status: "resolved",
      streamId: getCanonicalStreamId(target),
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
    send(command, context) {
      const deps = {
        db,
        now,
        resolveTarget,
        authorizeWrite: config.authorizeWrite,
        messageIdGenerator,
        outboundEventIdGenerator,
        findAcceptedMessageByClientMessageId,
        appendMessage,
      };

      if (config.publishDeliveryRequested !== undefined) {
        return sendMessage(command, context, {
          ...deps,
          publishDeliveryRequested: config.publishDeliveryRequested,
        });
      }

      return sendMessage(command, context, deps);
    },
  };
}

function createNow(): Date {
  return new Date();
}
