import type { Kysely } from "kysely";
import {
  assertActorId,
  assertIdempotencyKey,
  assertMessageId,
  assertSendMessageTarget,
  assertStreamId,
  generateDefaultMessageId,
  getSendMessageStreamId,
  normalizeMessageText,
} from "../../message-send";
import {
  createSendRequestFingerprint,
  matchesSendRequestFingerprint,
  type SendRequestFingerprint,
} from "../../send-request-fingerprint";
import type {
  MessageTargetResolver,
  MessageWriteAuthorizer,
  SendMessage,
  SendMessageDependencies,
  SendMessageInput,
  SendMessageResult,
  SenderScopedIdempotencyKey,
} from "../../send-message.types";
import type { MessageSendDatabase } from "../../message-send-table";
import { appendTextMessage, findSendMessageReceipt } from "./send-message.kysely";
import type {
  AppendTextMessageInput,
  AppendTextMessageResult,
  StoredSendMessageReceipt,
} from "./send-message.kysely";

export type SendMessageExecutionDependencies = {
  db: Kysely<MessageSendDatabase>;
  resolveTarget: MessageTargetResolver;
  authorizeWrite: MessageWriteAuthorizer;
  generateMessageId: () => string;
  createRequestFingerprint: (
    target: SendMessageInput["target"],
    normalizedText: string,
  ) => SendRequestFingerprint;
  findSendMessageReceipt: (
    db: Kysely<MessageSendDatabase>,
    key: SenderScopedIdempotencyKey,
  ) => Promise<StoredSendMessageReceipt | undefined>;
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
    createRequestFingerprint: createSendRequestFingerprint,
    findSendMessageReceipt,
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

  const requestFingerprint = dependencies.createRequestFingerprint(input.target, text);
  const scopedIdempotencyKey: SenderScopedIdempotencyKey = {
    senderActorId: input.senderActorId,
    idempotencyKey: input.idempotencyKey,
  };
  const existing = await dependencies.findSendMessageReceipt(dependencies.db, scopedIdempotencyKey);

  if (existing !== undefined) {
    return resultForExistingReceipt(requestFingerprint, existing);
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

  assertResolvedStreamMatchesTarget(resolvedTarget.streamId, input.target);

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

  const appendResult = await dependencies.appendTextMessage(dependencies.db, {
    ...scopedIdempotencyKey,
    messageId,
    streamId: resolvedTarget.streamId,
    target: input.target,
    text,
    requestFingerprint,
  });

  if (appendResult.status === "target_not_found") {
    return {
      status: "rejected",
      reason: "target_not_found",
    };
  }

  if (appendResult.status === "existing") {
    return resultForExistingReceipt(requestFingerprint, appendResult.receipt);
  }

  if (appendResult.receipt.message === undefined) {
    throw new Error("새로 저장한 message가 tombstone으로 반환됐습니다.");
  }

  return {
    status: "accepted",
    persistence: "created",
    message: appendResult.receipt.message,
  };
}

function resultForExistingReceipt(
  requestFingerprint: SendRequestFingerprint,
  existing: StoredSendMessageReceipt,
): SendMessageResult {
  if (!matchesSendRequestFingerprint(existing.requestFingerprint, requestFingerprint)) {
    return {
      status: "rejected",
      reason: "idempotency_conflict",
    };
  }

  if (existing.message === undefined) {
    throw new Error("tombstone message의 기존 send 결과는 현재 공개 계약으로 반환할 수 없습니다.");
  }

  return {
    status: "accepted",
    persistence: "existing",
    message: existing.message,
  };
}

function assertResolvedStreamMatchesTarget(
  resolvedStreamId: string,
  target: SendMessageInput["target"],
): void {
  if (resolvedStreamId !== getSendMessageStreamId(target)) {
    throw new Error("resolve된 streamId가 canonical message target과 일치하지 않습니다.");
  }
}
