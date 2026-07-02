import type {
  OutboundMessageDeliveryRequested,
  SendChannelMessageCommand,
  SendChannelMessageResult,
} from '../contract'
import { toChannelStreamId } from '../core/conversation-stream'
import type {
  ChatMessageRepositoryPort,
  OutboundEventBusPort,
  PermissionPort,
} from '../ports'

export type SendChannelMessageUseCase = {
  /**
   * Sends a channel message.
   *
   * The returned ACK only means the command was authorized, persisted, and assigned a stream
   * sequence. It never means recipient realtime delivery has succeeded.
   */
  execute(input: SendChannelMessageCommand): Promise<SendChannelMessageResult>
}

export type SendChannelMessageUseCaseDeps = {
  permissionPort: PermissionPort
  messageRepository: ChatMessageRepositoryPort
  outboundEventBus: OutboundEventBusPort
  generateMessageId: () => string
  generateDeliveryId: () => string
  now: () => number
  toChannelStreamId?: (channelId: string) => string
}

export function createSendChannelMessageUseCase(
  deps: SendChannelMessageUseCaseDeps,
): SendChannelMessageUseCase {
  return {
    async execute(input: SendChannelMessageCommand): Promise<SendChannelMessageResult> {
      const canWrite = await deps.permissionPort.canWriteChannel({
        actorId: input.actorId,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
      })

      if (!canWrite) {
        return {
          ok: false,
          reason: 'permission_denied',
        }
      }

      const streamId = (deps.toChannelStreamId ?? toChannelStreamId)(input.channelId)
      const serverCreatedAt = deps.now()
      const persisted = await deps.messageRepository.persistUserMessage({
        messageId: deps.generateMessageId(),
        streamId,
        senderId: input.actorId,
        clientMessageId: input.clientMessageId,
        content: input.content,
        serverCreatedAt,
      })

      const ack = {
        type: 'chat.message.accepted' as const,
        clientMessageId: input.clientMessageId,
        messageId: persisted.message.messageId,
        streamId: persisted.message.streamId,
        sequence: persisted.message.sequence,
        serverCreatedAt: persisted.message.serverCreatedAt,
      }

      const delivery: OutboundMessageDeliveryRequested = {
        type: 'OutboundMessageDeliveryRequested',
        deliveryId: deps.generateDeliveryId(),
        messageId: persisted.message.messageId,
        streamId: persisted.message.streamId,
        sequence: persisted.message.sequence,
        publishedAt: deps.now(),
      }

      try {
        await deps.outboundEventBus.publish(delivery)

        return {
          ok: true,
          ack,
          message: persisted.message,
          idempotentReplay: persisted.idempotentReplay,
          outboundDelivery: { ok: true },
        }
      } catch (error) {
        return {
          ok: true,
          ack,
          message: persisted.message,
          idempotentReplay: persisted.idempotentReplay,
          outboundDelivery: {
            ok: false,
            warning: 'outbound_publish_failed',
            error,
          },
        }
      }
    },
  }
}
