import type { MessageContent, MessageRecord } from '../contract'

export type PersistUserMessageInput = {
  messageId: string
  streamId: string
  senderId: string
  clientMessageId: string
  content: MessageContent
  serverCreatedAt: number
}

export type PersistUserMessageResult = {
  message: MessageRecord
  idempotentReplay: boolean
}

export type ListMessagesAfterInput = {
  streamId: string
  afterSequence: number
  limit?: number
}

export type ChatMessageRepositoryPort = {
  /**
   * Persists a user message under the repository's transaction boundary.
   *
   * Implementations must handle `senderId + streamId + clientMessageId` idempotency first. New
   * messages must lock the stream row, issue the next sequence for that stream, insert the message,
   * and record the idempotency key atomically.
   */
  persistUserMessage(input: PersistUserMessageInput): Promise<PersistUserMessageResult>

  /**
   * Returns messages in one stream with `sequence > afterSequence`, ordered by ascending sequence.
   */
  listMessagesAfter(input: ListMessagesAfterInput): Promise<MessageRecord[]>
}
