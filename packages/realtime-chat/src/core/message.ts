import type { MessageContent, MessageRecord, MessageType } from '../contract/chat-message'

export type CreateMessageInput = {
  messageId: string
  streamId: string
  sequence: number
  type: MessageType
  senderId?: string
  content: MessageContent
  clientMessageId?: string
  serverCreatedAt: number
}

export class Message {
  private readonly record: MessageRecord

  constructor(record: MessageRecord) {
    if (record.sequence <= 0) {
      throw new Error('message sequence must be positive')
    }

    this.record = record
  }

  get messageId(): string {
    return this.record.messageId
  }

  get streamId(): string {
    return this.record.streamId
  }

  get sequence(): number {
    return this.record.sequence
  }

  toRecord(): MessageRecord {
    return { ...this.record }
  }
}

export function createMessage(input: CreateMessageInput): MessageRecord {
  if (input.sequence <= 0) {
    throw new Error('message sequence must be positive')
  }

  const message: MessageRecord = {
    messageId: input.messageId,
    streamId: input.streamId,
    sequence: input.sequence,
    type: input.type,
    content: input.content,
    serverCreatedAt: input.serverCreatedAt,
  }

  if (input.senderId !== undefined) {
    message.senderId = input.senderId
  }

  if (input.clientMessageId !== undefined) {
    message.clientMessageId = input.clientMessageId
  }

  return message
}

export function compareMessagesByStreamSequence(left: MessageRecord, right: MessageRecord): number {
  if (left.streamId !== right.streamId) {
    throw new Error('cannot compare message sequence across different streams')
  }

  return left.sequence - right.sequence
}
