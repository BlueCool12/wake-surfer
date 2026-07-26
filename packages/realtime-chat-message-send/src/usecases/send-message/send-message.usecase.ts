import type {
  OutboundMessageDeliveryRequested,
  PublicMessage,
  SendMessageResponse,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import {
  getUtf8ByteLength,
  MAX_TEXT_UTF8_BYTES,
} from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";
import {
  assertActorId,
  assertClientMessageId,
  assertMessageContent,
  assertMessageId,
  assertMessageTarget,
  assertStreamId,
  createAcceptedResponse,
} from "../../message-send";
import type { MessageIdGenerator, OutboundEventIdGenerator } from "../../message-send";
import type {
  MessageTargetResolver,
  MessageWriteAuthorizer,
  OutboundDeliveryPublisher,
  SendMessageCommand,
  SendMessageContext,
} from "../../message-send-module";
import type { MessageSendDatabase } from "../../message-send-table";
import type { MessageAppendInput, MessageAppendResult } from "./send-message.kysely";

export type SendMessageDeps = {
  db: Kysely<MessageSendDatabase>;
  now: () => Date;
  resolveTarget: MessageTargetResolver;
  authorizeWrite: MessageWriteAuthorizer;
  publishDeliveryRequested?: OutboundDeliveryPublisher;
  messageIdGenerator: MessageIdGenerator;
  outboundEventIdGenerator: OutboundEventIdGenerator;
  findAcceptedMessageByClientMessageId: (
    db: Kysely<MessageSendDatabase>,
    input: {
      senderActorId: string;
      streamId: string;
      clientMessageId: string;
      target: SendMessageCommand["target"];
    },
  ) => Promise<PublicMessage | undefined>;
  appendMessage: (
    db: Kysely<MessageSendDatabase>,
    input: MessageAppendInput,
  ) => Promise<MessageAppendResult>;
};

export async function sendMessage(
  command: SendMessageCommand,
  context: SendMessageContext,
  deps: SendMessageDeps,
): Promise<SendMessageResponse> {
  assertActorId(context.actorId);
  assertClientMessageId(command.clientMessageId);
  assertMessageTarget(command.target);

  if (command.content.type !== "text") {
    return createRejectedResponse(command, "invalid_content");
  }

  const contentText = command.content.text.trim();

  if (contentText.length === 0 || getUtf8ByteLength(contentText) > MAX_TEXT_UTF8_BYTES) {
    return createRejectedResponse(command, "invalid_content");
  }

  const content = {
    type: "text" as const,
    text: contentText,
  };

  assertMessageContent(content);

  const resolvedTarget = await deps.resolveTarget({
    actorId: context.actorId,
    target: command.target,
  });

  if (resolvedTarget.status === "rejected") {
    return createRejectedResponse(command, resolvedTarget.reason);
  }

  assertStreamId(resolvedTarget.streamId);

  const existing = await deps.findAcceptedMessageByClientMessageId(deps.db, {
    senderActorId: context.actorId,
    streamId: resolvedTarget.streamId,
    clientMessageId: command.clientMessageId,
    target: command.target,
  });

  if (existing) {
    return createAcceptedResponse({
      command,
      message: existing,
    });
  }

  const authorization = await deps.authorizeWrite({
    actorId: context.actorId,
    target: command.target,
    streamId: resolvedTarget.streamId,
  });

  if (authorization.status === "denied") {
    return createRejectedResponse(command, "write_forbidden");
  }

  const messageId = deps.messageIdGenerator.generate();
  assertMessageId(messageId);

  const createdAt = deps.now().toISOString();
  const appendInput: MessageAppendInput = {
    messageId,
    streamId: resolvedTarget.streamId,
    senderActorId: context.actorId,
    target: command.target,
    clientMessageId: command.clientMessageId,
    content,
    createdAt,
  };

  if (command.sentAtClient !== undefined) {
    appendInput.sentAtClient = command.sentAtClient;
  }

  const appendResult = await deps.appendMessage(deps.db, appendInput);

  if (appendResult.status === "existing") {
    return createAcceptedResponse({
      command,
      message: appendResult.message,
    });
  }

  const savedMessage = appendResult.message;

  await publishDeliveryBestEffort(deps, {
    eventId: deps.outboundEventIdGenerator.generate(),
    occurredAt: createdAt,
    message: savedMessage,
    recipientActorIds: resolvedTarget.recipientActorIds,
  });

  return createAcceptedResponse({
    command,
    message: savedMessage,
  });
}

function createRejectedResponse(
  command: SendMessageCommand,
  reason: Extract<SendMessageResponse, { status: "rejected" }>["reason"],
): SendMessageResponse {
  const response: SendMessageResponse = {
    status: "rejected",
    clientMessageId: command.clientMessageId,
    reason,
  };

  if (command.commandId !== undefined) {
    response.commandId = command.commandId;
  }

  return response;
}

async function publishDeliveryBestEffort(
  deps: SendMessageDeps,
  event: OutboundMessageDeliveryRequested,
): Promise<void> {
  if (!deps.publishDeliveryRequested) {
    return;
  }

  try {
    await deps.publishDeliveryRequested(event);
  } catch {
    // 메시지 저장 성공과 실시간 delivery 성공은 분리한다.
  }
}
