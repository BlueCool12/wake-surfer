import type {
  RealtimeChatDbPort,
  RealtimeChatMessageTarget,
  StoredGatewayTicket,
  StoredReadCursor,
  StoredRealtimeChatMessage
} from '@wake-surfer/realtime-chat/api';

export function createInMemoryRealtimeChatDb(): RealtimeChatDbPort {
  return new InMemoryRealtimeChatDb();
}

class InMemoryRealtimeChatDb implements RealtimeChatDbPort {
  private readonly gatewayTickets = new Map<string, StoredGatewayTicket>();
  private readonly messagesByStream = new Map<string, StoredRealtimeChatMessage[]>();
  private readonly messagesByIdempotencyKey = new Map<string, StoredRealtimeChatMessage>();
  private readonly readCursors = new Map<string, StoredReadCursor>();
  private readonly streamSequences = new Map<string, number>();

  async issueGatewayTicket(ticket: StoredGatewayTicket): Promise<void> {
    this.gatewayTickets.set(ticket.ticketValueHash, ticket);
  }

  async findMessageByIdempotencyKey(
    idempotencyKey: string
  ): Promise<StoredRealtimeChatMessage | undefined> {
    return this.messagesByIdempotencyKey.get(idempotencyKey);
  }

  async appendMessage(
    input: Parameters<RealtimeChatDbPort['appendMessage']>[0]
  ): Promise<StoredRealtimeChatMessage> {
    const streamId = streamIdForTarget(input.target);
    const sequence = (this.streamSequences.get(streamId) ?? 0) + 1;
    this.streamSequences.set(streamId, sequence);

    const message: StoredRealtimeChatMessage = {
      messageId: input.messageId,
      streamId,
      streamType: input.streamType,
      sequence,
      ...(input.senderId ? { senderId: input.senderId } : {}),
      messageType: input.messageType,
      content: input.content,
      createdAt: input.createdAt,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
    };

    const streamMessages = this.messagesByStream.get(streamId) ?? [];
    streamMessages.push(message);
    this.messagesByStream.set(streamId, streamMessages);

    if (input.idempotencyKey) {
      this.messagesByIdempotencyKey.set(input.idempotencyKey, message);
    }

    return message;
  }

  async markReadCursor(
    input: Parameters<RealtimeChatDbPort['markReadCursor']>[0]
  ): Promise<StoredReadCursor> {
    const key = `${input.actorId}:${input.streamId}`;
    const current = this.readCursors.get(key);
    const nextSequence = Math.max(
      current?.lastReadSequence ?? 0,
      input.lastReadSequence
    );
    const cursor: StoredReadCursor = {
      actorId: input.actorId,
      streamId: input.streamId,
      lastReadSequence: nextSequence,
      updatedAt: input.updatedAt,
      advanced: nextSequence > (current?.lastReadSequence ?? 0)
    };

    this.readCursors.set(key, cursor);
    return cursor;
  }

  async listMessages(
    input: Parameters<RealtimeChatDbPort['listMessages']>[0]
  ): Promise<Awaited<ReturnType<RealtimeChatDbPort['listMessages']>>> {
    const messages = [...(this.messagesByStream.get(input.streamId) ?? [])];
    const filtered = messages.filter((message) => {
      if (
        input.afterSequence !== undefined &&
        message.sequence <= input.afterSequence
      ) {
        return false;
      }

      if (
        input.beforeSequence !== undefined &&
        message.sequence >= input.beforeSequence
      ) {
        return false;
      }

      return true;
    });
    const page = filtered.slice(0, input.limit);

    return {
      messages: page,
      hasMoreBefore: hasMoreBefore(messages, page),
      hasMoreAfter: filtered.length > page.length
    };
  }

  async destroy(): Promise<void> {
    this.gatewayTickets.clear();
    this.messagesByStream.clear();
    this.messagesByIdempotencyKey.clear();
    this.readCursors.clear();
    this.streamSequences.clear();
  }
}

function hasMoreBefore(
  allMessages: StoredRealtimeChatMessage[],
  page: StoredRealtimeChatMessage[]
): boolean {
  const first = page[0];

  if (!first) {
    return false;
  }

  return allMessages.some((message) => message.sequence < first.sequence);
}

function streamIdForTarget(target: RealtimeChatMessageTarget): string {
  if (target.kind === 'channel') {
    return `channel:${target.workspaceId}:${target.channelId}`;
  }

  if (target.kind === 'dm') {
    return `dm:${target.dmConversationId}`;
  }

  return `thread:${target.threadId}`;
}
