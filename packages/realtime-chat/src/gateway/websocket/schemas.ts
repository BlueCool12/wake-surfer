import type {
  RealtimeChatClientEvent,
  RealtimeChatErrorCode,
  TextMessageContentDto
} from '@wake-surfer/realtime-chat-contracts';

type ParseResult =
  | {
      ok: true;
      event: RealtimeChatClientEvent;
    }
  | {
      ok: false;
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export function parseRealtimeChatClientEvent(
  rawPayload: string,
  maxPayloadBytes: number
): ParseResult {
  if (new TextEncoder().encode(rawPayload).byteLength > maxPayloadBytes) {
    return {
      ok: false,
      reason: 'PAYLOAD_TOO_LARGE'
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return {
      ok: false,
      reason: 'INVALID_PAYLOAD',
      message: 'payload must be valid JSON'
    };
  }

  const record = asRecord(parsed);

  if (!record) {
    return {
      ok: false,
      reason: 'INVALID_PAYLOAD',
      message: 'event must be an object'
    };
  }

  const type = stringField(record, 'type');

  if (type === 'chat.channel.message.send') {
    return parseChannelMessageSendEvent(record);
  }

  if (type === 'chat.dm.message.send') {
    return parseDMMessageSendEvent(record);
  }

  if (type === 'chat.thread.message.reply') {
    return parseThreadMessageReplyEvent(record);
  }

  if (type === 'chat.channel.read.mark') {
    return parseChannelReadMarkEvent(record);
  }

  if (type === 'chat.stream.sync') {
    return parseStreamSyncEvent(record);
  }

  return {
    ok: false,
    reason: 'UNSUPPORTED_EVENT_TYPE'
  };
}

function parseChannelMessageSendEvent(record: Record<string, unknown>): ParseResult {
  const commandId = stringField(record, 'commandId');
  const clientMessageId = stringField(record, 'clientMessageId');
  const workspaceId = stringField(record, 'workspaceId');
  const channelId = stringField(record, 'channelId');
  const sentAtClient = stringField(record, 'sentAtClient');
  const content = textContentField(record['content']);

  if (!commandId || !clientMessageId || !workspaceId || !channelId || !sentAtClient || !content) {
    return invalidPayload('channel message event is missing required fields');
  }

  return {
    ok: true,
    event: {
      type: 'chat.channel.message.send',
      commandId,
      clientMessageId,
      workspaceId,
      channelId,
      content,
      sentAtClient
    }
  };
}

function parseDMMessageSendEvent(record: Record<string, unknown>): ParseResult {
  const commandId = stringField(record, 'commandId');
  const clientMessageId = stringField(record, 'clientMessageId');
  const dmConversationId = stringField(record, 'dmConversationId');
  const sentAtClient = stringField(record, 'sentAtClient');
  const content = textContentField(record['content']);

  if (!commandId || !clientMessageId || !dmConversationId || !sentAtClient || !content) {
    return invalidPayload('dm message event is missing required fields');
  }

  return {
    ok: true,
    event: {
      type: 'chat.dm.message.send',
      commandId,
      clientMessageId,
      dmConversationId,
      content,
      sentAtClient
    }
  };
}

function parseThreadMessageReplyEvent(record: Record<string, unknown>): ParseResult {
  const commandId = stringField(record, 'commandId');
  const clientMessageId = stringField(record, 'clientMessageId');
  const threadId = stringField(record, 'threadId');
  const sentAtClient = stringField(record, 'sentAtClient');
  const content = textContentField(record['content']);

  if (!commandId || !clientMessageId || !threadId || !sentAtClient || !content) {
    return invalidPayload('thread reply event is missing required fields');
  }

  return {
    ok: true,
    event: {
      type: 'chat.thread.message.reply',
      commandId,
      clientMessageId,
      threadId,
      content,
      sentAtClient
    }
  };
}

function parseChannelReadMarkEvent(record: Record<string, unknown>): ParseResult {
  const commandId = stringField(record, 'commandId');
  const streamId = stringField(record, 'streamId');
  const lastReadSequence = nonNegativeIntegerField(record, 'lastReadSequence');

  if (!commandId || !streamId || lastReadSequence === undefined) {
    return invalidPayload('read mark event is missing required fields');
  }

  return {
    ok: true,
    event: {
      type: 'chat.channel.read.mark',
      commandId,
      streamId,
      lastReadSequence
    }
  };
}

function parseStreamSyncEvent(record: Record<string, unknown>): ParseResult {
  const commandId = stringField(record, 'commandId');
  const streamId = stringField(record, 'streamId');
  const afterSequence = nonNegativeIntegerField(record, 'afterSequence');
  const beforeSequence = nonNegativeIntegerField(record, 'beforeSequence');
  const limit = positiveIntegerField(record, 'limit');

  if (!commandId || !streamId || afterSequence === undefined) {
    return invalidPayload('stream sync event is missing required fields');
  }

  return {
    ok: true,
    event: {
      type: 'chat.stream.sync',
      commandId,
      streamId,
      afterSequence,
      ...(beforeSequence !== undefined ? { beforeSequence } : {}),
      ...(limit !== undefined ? { limit } : {})
    }
  };
}

function invalidPayload(message: string): ParseResult {
  return {
    ok: false,
    reason: 'INVALID_PAYLOAD',
    message
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  record: Record<string, unknown>,
  field: string
): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

function textContentField(value: unknown): TextMessageContentDto | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const kind = stringField(record, 'kind');
  const text = stringField(record, 'text');

  return kind === 'text' && text
    ? {
        kind: 'text',
        text
      }
    : undefined;
}

function nonNegativeIntegerField(
  record: Record<string, unknown>,
  field: string
): number | undefined {
  const value = record[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function positiveIntegerField(
  record: Record<string, unknown>,
  field: string
): number | undefined {
  const value = record[field];
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
