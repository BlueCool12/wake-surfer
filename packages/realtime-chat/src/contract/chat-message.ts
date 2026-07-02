export type MessageType = 'USER' | 'SYSTEM'

export type TextMessageContent = {
  type: 'TEXT'
  text: string
}

export type MessageContent = TextMessageContent

export type MessageRecord = {
  messageId: string
  streamId: string
  sequence: number
  type: MessageType
  senderId?: string
  content: MessageContent
  clientMessageId?: string
  serverCreatedAt: number
}

export type SendChannelMessageCommand = {
  type: 'chat.channel.message.send'
  commandId: string
  clientMessageId: string
  actorId: string
  workspaceId: string
  channelId: string
  content: MessageContent
  sentAtClient?: string
}

export type ChatMessageAccepted = {
  type: 'chat.message.accepted'
  clientMessageId: string
  messageId: string
  streamId: string
  sequence: number
  serverCreatedAt: number
}

export type SendChannelMessageResult =
  | {
      ok: true
      ack: ChatMessageAccepted
      message: MessageRecord
      idempotentReplay: boolean
      outboundDelivery: OutboundDeliveryPublishResult
    }
  | {
      ok: false
      reason: 'permission_denied'
    }

export type OutboundDeliveryPublishResult =
  | {
      ok: true
    }
  | {
      ok: false
      warning: 'outbound_publish_failed'
      error: unknown
    }

export type SyncChatStreamCommand = {
  type: 'chat.stream.sync'
  streamId: string
  afterSequence: number
  limit?: number
}

export type SyncChatStreamResult = {
  type: 'chat.stream.synced'
  streamId: string
  afterSequence: number
  messages: MessageRecord[]
}
