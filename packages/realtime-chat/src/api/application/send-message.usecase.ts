import type {
  MessageCommandResponse,
  ReplyThreadMessageRequest,
  SendChannelMessageRequest,
  SendDMMessageRequest
} from '@wake-surfer/realtime-chat-contracts';
import type { RealtimeChatApiMountOptions } from '../http/mount';
import type {
  RealtimeChatApiRuntimeDeps,
  RealtimeChatMessageTarget,
  StoredRealtimeChatMessage
} from '../runtime-deps';
import {
  toAcceptedResponse,
  toChatMessageCreatedEvent,
  validateMessageText
} from '../domain/message';
import { buildUserMessageIdempotencyKey } from '../domain/policies';

type SendMessageCommand = {
  commandId: string;
  actorId: string;
  target: RealtimeChatMessageTarget;
  clientMessageId: string;
  content: {
    kind: 'text';
    text: string;
  };
};

export async function sendChannelMessage(
  request: SendChannelMessageRequest,
  deps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions
): Promise<MessageCommandResponse> {
  return sendUserMessage(
    {
      commandId: request.requestId,
      actorId: request.actorId,
      target: {
        kind: 'channel',
        workspaceId: request.workspaceId,
        channelId: request.channelId
      },
      clientMessageId: request.clientMessageId,
      content: request.content
    },
    deps,
    options
  );
}

export async function sendDMMessage(
  request: SendDMMessageRequest,
  deps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions
): Promise<MessageCommandResponse> {
  return sendUserMessage(
    {
      commandId: request.requestId,
      actorId: request.actorId,
      target: {
        kind: 'dm',
        dmConversationId: request.dmConversationId
      },
      clientMessageId: request.clientMessageId,
      content: request.content
    },
    deps,
    options
  );
}

export async function replyThreadMessage(
  request: ReplyThreadMessageRequest,
  deps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions
): Promise<MessageCommandResponse> {
  return sendUserMessage(
    {
      commandId: request.requestId,
      actorId: request.actorId,
      target: {
        kind: 'thread',
        threadId: request.threadId
      },
      clientMessageId: request.clientMessageId,
      content: request.content
    },
    deps,
    options
  );
}

async function sendUserMessage(
  command: SendMessageCommand,
  deps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions
): Promise<MessageCommandResponse> {
  const contentError = validateMessageText(
    command.content.text,
    options.maxMessageTextLength ?? 4000
  );

  if (contentError) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      clientMessageId: command.clientMessageId,
      reason: contentError
    };
  }

  const permission = await deps.permissionPort.canWriteMessage({
    actorId: command.actorId,
    target: command.target
  });

  if (!permission.allowed) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      clientMessageId: command.clientMessageId,
      reason: permission.reason,
      ...(permission.message ? { message: permission.message } : {})
    };
  }

  const idempotencyKey = buildUserMessageIdempotencyKey(
    command.actorId,
    command.target,
    command.clientMessageId
  );
  const existing = await deps.db.findMessageByIdempotencyKey(idempotencyKey);

  if (existing) {
    return toAcceptedResponse(
      command.commandId,
      existing,
      command.clientMessageId
    );
  }

  try {
    const message = await deps.db.appendMessage({
      messageId: deps.idGenerator.generateId('message'),
      target: command.target,
      streamType: streamTypeForTarget(command.target),
      senderId: command.actorId,
      messageType: 'USER',
      content: command.content,
      idempotencyKey,
      createdAt: deps.clock.now().toISOString()
    });

    await publishDeliveryBestEffort(command.actorId, command.target, message, deps);
    deps.metrics?.increment('realtime_chat.message.accepted', {
      streamType: message.streamType
    });

    return toAcceptedResponse(
      command.commandId,
      message,
      command.clientMessageId
    );
  } catch (error) {
    deps.logger.error('failed to save realtime chat message', {
      error,
      target: command.target
    });

    return {
      status: 'rejected',
      commandId: command.commandId,
      clientMessageId: command.clientMessageId,
      reason: 'MESSAGE_SAVE_FAILED'
    };
  }
}

async function publishDeliveryBestEffort(
  actorId: string | undefined,
  target: RealtimeChatMessageTarget,
  message: StoredRealtimeChatMessage,
  deps: RealtimeChatApiRuntimeDeps
): Promise<void> {
  try {
    const recipientUserIds = await deps.permissionPort.resolveMessageRecipients({
      ...(actorId ? { actorId } : {}),
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
  } catch (error) {
    deps.logger.warn('failed to publish realtime chat outbound delivery event', {
      error,
      streamId: message.streamId,
      messageId: message.messageId
    });
  }
}

function streamTypeForTarget(target: RealtimeChatMessageTarget): 'CHANNEL' | 'DM' | 'THREAD' {
  if (target.kind === 'channel') {
    return 'CHANNEL';
  }

  if (target.kind === 'dm') {
    return 'DM';
  }

  return 'THREAD';
}
