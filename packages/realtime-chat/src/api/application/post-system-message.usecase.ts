import type {
  MessageCommandResponse,
  PostSessionStartedSystemMessageRequest
} from '@wake-surfer/realtime-chat-contracts';
import type { RealtimeChatApiRuntimeDeps } from '../runtime-deps';
import {
  toAcceptedResponse,
  toChatMessageCreatedEvent
} from '../domain/message';
import { buildUserMessageIdempotencyKey } from '../domain/policies';

export async function postSessionStartedSystemMessage(
  request: PostSessionStartedSystemMessageRequest,
  deps: RealtimeChatApiRuntimeDeps
): Promise<MessageCommandResponse> {
  const target = {
    kind: 'channel' as const,
    workspaceId: request.workspaceId,
    channelId: request.channelId
  };
  const idempotencyKey = buildUserMessageIdempotencyKey(
    request.actorId ?? 'system',
    target,
    request.sourceEventId
  );
  const existing = await deps.db.findMessageByIdempotencyKey(idempotencyKey);

  if (existing) {
    return toAcceptedResponse(request.requestId, existing);
  }

  try {
    const message = await deps.db.appendMessage({
      messageId: deps.idGenerator.generateId('message'),
      target,
      streamType: 'CHANNEL',
      ...(request.actorId ? { senderId: request.actorId } : {}),
      messageType: 'SYSTEM',
      content: {
        kind: 'system',
        text: request.title
          ? `Session started: ${request.title}`
          : 'Session started',
        metadata: {
          sessionId: request.sessionId,
          sourceEventId: request.sourceEventId
        }
      },
      idempotencyKey,
      createdAt: request.occurredAt
    });
    const recipientUserIds = await deps.permissionPort.resolveMessageRecipients({
      ...(request.actorId ? { actorId: request.actorId } : {}),
      target,
      streamId: message.streamId
    });

    await deps.outboundEventBus.publish({
      eventId: deps.idGenerator.generateId('outbound-message-delivery-requested'),
      eventType: 'OutboundMessageDeliveryRequested',
      occurredAt: deps.clock.now().toISOString(),
      streamId: message.streamId,
      streamType: message.streamType,
      messageId: message.messageId,
      sequence: message.sequence,
      recipientUserIds,
      payload: toChatMessageCreatedEvent(message)
    });

    return toAcceptedResponse(request.requestId, message);
  } catch (error) {
    deps.logger.error('failed to save realtime chat system message', {
      error,
      channelId: request.channelId,
      sessionId: request.sessionId
    });

    return {
      status: 'rejected',
      commandId: request.requestId,
      reason: 'MESSAGE_SAVE_FAILED'
    };
  }
}
