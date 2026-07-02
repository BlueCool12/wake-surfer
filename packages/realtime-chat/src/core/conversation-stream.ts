export type ConversationStreamType = 'CHANNEL' | 'DM' | 'THREAD'

export type ConversationStreamSnapshot = {
  streamId: string
  type: ConversationStreamType
  ownerId: string
  lastSequence: number
  createdAt: number
  updatedAt: number
}

export class ConversationStream {
  private readonly snapshot: ConversationStreamSnapshot

  constructor(snapshot: ConversationStreamSnapshot) {
    if (snapshot.lastSequence < 0) {
      throw new Error('conversation stream lastSequence cannot be negative')
    }

    this.snapshot = snapshot
  }

  get streamId(): string {
    return this.snapshot.streamId
  }

  get lastSequence(): number {
    return this.snapshot.lastSequence
  }

  /**
   * Stream sequence is scoped to one stream; values from different streams must not be compared.
   */
  issueNextSequence(now: number): ConversationStreamSequenceIssue {
    const sequence = this.snapshot.lastSequence + 1

    return {
      sequence,
      stream: new ConversationStream({
        ...this.snapshot,
        lastSequence: sequence,
        updatedAt: now,
      }),
    }
  }

  toSnapshot(): ConversationStreamSnapshot {
    return { ...this.snapshot }
  }
}

export type ConversationStreamSequenceIssue = {
  sequence: number
  stream: ConversationStream
}

export function toChannelStreamId(channelId: string): string {
  return `channel-${channelId}`
}
