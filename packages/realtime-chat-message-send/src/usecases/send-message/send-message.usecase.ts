import type { Kysely } from "kysely";
import {
  assertActorId,
  assertIdempotencyKey,
  assertMessageId,
  assertSendMessageTarget,
  assertStreamId,
  getSendMessageTargetId,
  getSendMessageTargetType,
  generateDefaultMessageId,
  normalizeMessageText,
} from "../../message-send";
import type {
  AppendedTextMessage,
  MessageTargetResolver,
  MessageWriteAuthorizer,
  SendMessage,
  SendMessageDependencies,
  SendMessageInput,
  SendMessageResult,
  SenderScopedIdempotencyKey,
} from "../../send-message.types";
import type { MessageSendDatabase } from "../../message-send-table";
import { appendTextMessage, findAppendedTextMessageByIdempotencyKey } from "./send-message.kysely";
import type { AppendTextMessageInput, AppendTextMessageResult } from "./send-message.kysely";

export type SendMessageExecutionDependencies = {
  db: Kysely<MessageSendDatabase>;
  now: () => Date;
  resolveTarget: MessageTargetResolver;
  authorizeWrite: MessageWriteAuthorizer;
  generateMessageId: () => string;
  findAppendedTextMessageByIdempotencyKey: (
    db: Kysely<MessageSendDatabase>,
    key: SenderScopedIdempotencyKey,
  ) => Promise<AppendedTextMessage | undefined>;
  appendTextMessage: (
    db: Kysely<MessageSendDatabase>,
    input: AppendTextMessageInput,
  ) => Promise<AppendTextMessageResult>;
};

export function createSendMessage<DB extends MessageSendDatabase>(
  dependencies: SendMessageDependencies<DB>,
): SendMessage {
  const db = dependencies.db as Kysely<MessageSendDatabase>;
  const executionDependencies: SendMessageExecutionDependencies = {
    db,
    authorizeWrite: dependencies.authorizeWrite,
    resolveTarget: dependencies.resolveTarget,
    generateMessageId: dependencies.generateMessageId ?? generateDefaultMessageId,
    now: dependencies.now ?? createNow,
    findAppendedTextMessageByIdempotencyKey,
    appendTextMessage,
  };

  return (input) => executeSendMessage(input, executionDependencies);
}

export async function executeSendMessage(
  input: SendMessageInput,
  dependencies: SendMessageExecutionDependencies,
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
  const existing = await dependencies.findAppendedTextMessageByIdempotencyKey(
    dependencies.db,
    scopedIdempotencyKey,
  );

  if (existing !== undefined) {
    return resultForExistingMessage(input, text, existing);
  }

  const resolvedTarget = await dependencies.resolveTarget({
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

  const authorization = await dependencies.authorizeWrite({
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

  const messageId = dependencies.generateMessageId();
  assertMessageId(messageId);

  const createdAt = dependencies.now();

  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("message createdAt을 생성하는 server clock이 올바르지 않습니다.");
  }

  const appendResult = await dependencies.appendTextMessage(dependencies.db, {
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

  return {
    status: "accepted",
    persistence: "created",
    message: appendResult.message,
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
    persistence: "existing",
    message: existing,
  };
}

function createNow(): Date {
  return new Date();
}
