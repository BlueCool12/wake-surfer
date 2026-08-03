import type { OutboundMessageDeliveryRequested } from "@wake-surfer/realtime-chat-message-send-contracts";
import type { Kysely } from "kysely";
import {
  assertActorId,
  assertIdempotencyKey,
  assertMessageId,
  assertSendMessageTarget,
  assertStreamId,
  getSendMessageTargetId,
  getSendMessageTargetType,
  normalizeMessageText,
  toAcceptedTextMessage,
} from "../../message-send";
import type {
  AppendedTextMessage,
  MessageIdGenerator,
  OutboundEventIdGenerator,
  SendMessageInput,
  SendMessageResult,
  SenderScopedIdempotencyKey,
} from "../../message-send";
import type {
  MessageTargetResolver,
  MessageWriteAuthorizer,
  OutboundDeliveryPublisher,
} from "../../message-send-module";
import type { MessageSendDatabase } from "../../message-send-table";
import type { AppendTextMessageInput, AppendTextMessageResult } from "./send-message.kysely";

export type SendMessageDeps = {
  db: Kysely<MessageSendDatabase>;
  now: () => Date;
  resolveTarget: MessageTargetResolver;
  authorizeWrite: MessageWriteAuthorizer;
  publishDeliveryRequested?: OutboundDeliveryPublisher;
  messageIdGenerator: MessageIdGenerator;
  outboundEventIdGenerator: OutboundEventIdGenerator;
  findAppendedTextMessageByIdempotencyKey: (
    db: Kysely<MessageSendDatabase>,
    key: SenderScopedIdempotencyKey,
  ) => Promise<AppendedTextMessage | undefined>;
  appendTextMessage: (
    db: Kysely<MessageSendDatabase>,
    input: AppendTextMessageInput,
  ) => Promise<AppendTextMessageResult>;
};

export async function sendMessage(
  input: SendMessageInput,
  deps: SendMessageDeps,
): Promise<SendMessageResult> {
  assertActorId(input.senderActorId);
  assertIdempotencyKey(input.idempotencyKey);
  assertSendMessageTarget(input.target);

  const text = normalizeMessageText(input.text);

  if (text === undefined) {
    return {
      status: "rejected",
      reason: "invalid_text",
    };
  }

  const scopedIdempotencyKey: SenderScopedIdempotencyKey = {
    senderActorId: input.senderActorId,
    idempotencyKey: input.idempotencyKey,
  };
  const existing = await deps.findAppendedTextMessageByIdempotencyKey(
    deps.db,
    scopedIdempotencyKey,
  );

  if (existing !== undefined) {
    return resultForExistingMessage(input, text, existing);
  }

  const resolvedTarget = await deps.resolveTarget({
    senderActorId: input.senderActorId,
    target: input.target,
  });

  if (resolvedTarget.status === "rejected") {
    return {
      status: "rejected",
      reason: resolvedTarget.reason,
    };
  }

  assertStreamId(resolvedTarget.streamId);

  const authorization = await deps.authorizeWrite({
    senderActorId: input.senderActorId,
    target: input.target,
    streamId: resolvedTarget.streamId,
  });

  if (authorization.status === "denied") {
    return {
      status: "rejected",
      reason: "write_forbidden",
    };
  }

  const messageId = deps.messageIdGenerator.generate();
  assertMessageId(messageId);

  const createdAt = deps.now();

  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("message createdAt을 생성하는 server clock이 올바르지 않습니다.");
  }

  const appendResult = await deps.appendTextMessage(deps.db, {
    ...scopedIdempotencyKey,
    messageId,
    streamId: resolvedTarget.streamId,
    target: input.target,
    text,
    createdAt,
  });

  if (appendResult.status === "existing") {
    return resultForExistingMessage(input, text, appendResult.message);
  }

  const savedMessage = appendResult.message;

  await publishDeliveryBestEffort(deps, {
    eventId: deps.outboundEventIdGenerator.generate(),
    occurredAt: savedMessage.createdAt.toISOString(),
    message: toAcceptedTextMessage(savedMessage),
    recipientActorIds: resolvedTarget.recipientActorIds,
  });

  return {
    status: "accepted",
    message: savedMessage,
  };
}

function resultForExistingMessage(
  input: SendMessageInput,
  text: string,
  existing: AppendedTextMessage,
): SendMessageResult {
  if (
    existing.senderActorId !== input.senderActorId ||
    getSendMessageTargetType(existing.target) !== getSendMessageTargetType(input.target) ||
    getSendMessageTargetId(existing.target) !== getSendMessageTargetId(input.target) ||
    existing.text !== text
  ) {
    return {
      status: "rejected",
      reason: "idempotency_conflict",
    };
  }

  return {
    status: "accepted",
    message: existing,
  };
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
