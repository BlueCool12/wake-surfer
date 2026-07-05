import type {
  PostSessionStartedSystemMessageRequest,
  ReplyThreadMessageRequest,
  SendChannelMessageRequest,
  SendDMMessageRequest,
} from "@wake-surfer/realtime-chat-contracts";
import {
  asRecord,
  invalid,
  optionalStringField,
  stringField,
  valid,
  type ValidationResult,
} from "./validation";
import { parseTextMessageContent } from "./message-content.schema";

export function parseSendChannelMessageRequest(
  value: unknown,
): ValidationResult<SendChannelMessageRequest> {
  const record = asRecord(value);

  if (!record) {
    return invalid("request body must be an object");
  }

  const requestId = stringField(record, "requestId");
  const actorId = stringField(record, "actorId");
  const workspaceId = stringField(record, "workspaceId");
  const channelId = stringField(record, "channelId");
  const clientMessageId = stringField(record, "clientMessageId");
  const sentAtClient = stringField(record, "sentAtClient");
  const content = parseTextMessageContent(record["content"]);

  if (!requestId || !actorId || !workspaceId || !channelId || !clientMessageId || !sentAtClient) {
    return invalid(
      "requestId, actorId, workspaceId, channelId, clientMessageId, and sentAtClient are required",
    );
  }

  if (!content.ok) {
    return invalid(content.message);
  }

  return valid({
    requestId,
    actorId,
    workspaceId,
    channelId,
    clientMessageId,
    content: content.value,
    sentAtClient,
  });
}

export function parseSendDMMessageRequest(value: unknown): ValidationResult<SendDMMessageRequest> {
  const record = asRecord(value);

  if (!record) {
    return invalid("request body must be an object");
  }

  const requestId = stringField(record, "requestId");
  const actorId = stringField(record, "actorId");
  const dmConversationId = stringField(record, "dmConversationId");
  const clientMessageId = stringField(record, "clientMessageId");
  const sentAtClient = stringField(record, "sentAtClient");
  const content = parseTextMessageContent(record["content"]);

  if (!requestId || !actorId || !dmConversationId || !clientMessageId || !sentAtClient) {
    return invalid(
      "requestId, actorId, dmConversationId, clientMessageId, and sentAtClient are required",
    );
  }

  if (!content.ok) {
    return invalid(content.message);
  }

  return valid({
    requestId,
    actorId,
    dmConversationId,
    clientMessageId,
    content: content.value,
    sentAtClient,
  });
}

export function parseReplyThreadMessageRequest(
  value: unknown,
): ValidationResult<ReplyThreadMessageRequest> {
  const record = asRecord(value);

  if (!record) {
    return invalid("request body must be an object");
  }

  const requestId = stringField(record, "requestId");
  const actorId = stringField(record, "actorId");
  const threadId = stringField(record, "threadId");
  const clientMessageId = stringField(record, "clientMessageId");
  const sentAtClient = stringField(record, "sentAtClient");
  const content = parseTextMessageContent(record["content"]);

  if (!requestId || !actorId || !threadId || !clientMessageId || !sentAtClient) {
    return invalid("requestId, actorId, threadId, clientMessageId, and sentAtClient are required");
  }

  if (!content.ok) {
    return invalid(content.message);
  }

  return valid({
    requestId,
    actorId,
    threadId,
    clientMessageId,
    content: content.value,
    sentAtClient,
  });
}

export function parsePostSessionStartedSystemMessageRequest(
  value: unknown,
): ValidationResult<PostSessionStartedSystemMessageRequest> {
  const record = asRecord(value);

  if (!record) {
    return invalid("request body must be an object");
  }

  const requestId = stringField(record, "requestId");
  const sourceEventId = stringField(record, "sourceEventId");
  const workspaceId = stringField(record, "workspaceId");
  const channelId = stringField(record, "channelId");
  const sessionId = stringField(record, "sessionId");
  const occurredAt = stringField(record, "occurredAt");

  if (!requestId || !sourceEventId || !workspaceId || !channelId || !sessionId || !occurredAt) {
    return invalid(
      "requestId, sourceEventId, workspaceId, channelId, sessionId, and occurredAt are required",
    );
  }

  const actorId = optionalStringField(record, "actorId");
  const title = optionalStringField(record, "title");

  return valid({
    requestId,
    sourceEventId,
    workspaceId,
    channelId,
    sessionId,
    occurredAt,
    ...(actorId ? { actorId } : {}),
    ...(title ? { title } : {}),
  });
}
