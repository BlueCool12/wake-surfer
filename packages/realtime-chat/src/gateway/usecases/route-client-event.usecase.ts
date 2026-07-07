import type {
  ChatMessageAcceptedEvent,
  ChatMessageCreatedEvent,
  ChatMessageRejectedEvent,
  MessageCommandResponse,
  PublicMessageDto,
  RealtimeChatClientEvent,
  RealtimeChatServerEvent,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatGatewayRuntimeDeps } from "../runtime-deps";
import type { GatewaySession } from "../session/gateway-session";

export async function routeClientEvent(
  event: RealtimeChatClientEvent,
  session: GatewaySession,
  deps: RealtimeChatGatewayRuntimeDeps,
): Promise<RealtimeChatServerEvent> {
  try {
    if (event.type === "chat.channel.message.send") {
      return messageCommandResponseToSocketEvent(
        await deps.chatApiClient.sendChannelMessage({
          requestId: event.commandId,
          actorId: session.userId,
          workspaceId: event.workspaceId,
          channelId: event.channelId,
          clientMessageId: event.clientMessageId,
          content: event.content,
          sentAtClient: event.sentAtClient,
        }),
        event.clientMessageId,
      );
    }

    if (event.type === "chat.dm.message.send") {
      return messageCommandResponseToSocketEvent(
        await deps.chatApiClient.sendDMMessage({
          requestId: event.commandId,
          actorId: session.userId,
          dmConversationId: event.dmConversationId,
          clientMessageId: event.clientMessageId,
          content: event.content,
          sentAtClient: event.sentAtClient,
        }),
        event.clientMessageId,
      );
    }

    if (event.type === "chat.thread.message.reply") {
      return messageCommandResponseToSocketEvent(
        await deps.chatApiClient.replyThreadMessage({
          requestId: event.commandId,
          actorId: session.userId,
          threadId: event.threadId,
          clientMessageId: event.clientMessageId,
          content: event.content,
          sentAtClient: event.sentAtClient,
        }),
        event.clientMessageId,
      );
    }

    if (event.type === "chat.channel.read.mark") {
      const response = await deps.chatApiClient.markReadCursor({
        requestId: event.commandId,
        actorId: session.userId,
        streamId: event.streamId,
        lastReadSequence: event.lastReadSequence,
      });

      return {
        type: "chat.read-cursor.updated",
        commandId: response.commandId,
        streamId: response.streamId,
        lastReadSequence: response.lastReadSequence,
        updatedAt: response.updatedAt,
      };
    }

    const response = await deps.chatApiClient.syncStreamMessages({
      requestId: event.commandId,
      actorId: session.userId,
      streamId: event.streamId,
      afterSequence: event.afterSequence,
      ...(event.beforeSequence !== undefined ? { beforeSequence: event.beforeSequence } : {}),
      ...(event.limit !== undefined ? { limit: event.limit } : {}),
    });

    return {
      type: "chat.stream.synced",
      commandId: event.commandId,
      streamId: response.streamId,
      messages: response.messages.map(publicMessageToCreatedEvent),
      hasMoreBefore: response.hasMoreBefore,
      hasMoreAfter: response.hasMoreAfter,
    };
  } catch (error) {
    deps.logger.warn("failed to route realtime chat client event", {
      error,
      eventType: event.type,
      sessionId: session.sessionId,
    });

    return {
      type: "gateway.error",
      reason: "API_UNAVAILABLE",
      commandId: event.commandId,
      retryable: true,
    };
  }
}

function messageCommandResponseToSocketEvent(
  response: MessageCommandResponse,
  fallbackClientMessageId: string,
): ChatMessageAcceptedEvent | ChatMessageRejectedEvent {
  if (response.status === "rejected") {
    return {
      type: "chat.message.rejected",
      commandId: response.commandId,
      ...(response.clientMessageId || fallbackClientMessageId
        ? { clientMessageId: response.clientMessageId ?? fallbackClientMessageId }
        : {}),
      reason: response.reason,
      ...(response.message ? { message: response.message } : {}),
    };
  }

  return {
    type: "chat.message.accepted",
    commandId: response.commandId,
    clientMessageId: response.clientMessageId ?? fallbackClientMessageId,
    messageId: response.messageId,
    streamId: response.streamId,
    sequence: response.sequence,
    serverCreatedAt: response.serverCreatedAt,
  };
}

function publicMessageToCreatedEvent(message: PublicMessageDto): ChatMessageCreatedEvent {
  return {
    type: "chat.message.created",
    messageId: message.messageId,
    streamId: message.streamId,
    streamType: message.streamType,
    sequence: message.sequence,
    ...(message.senderId ? { senderId: message.senderId } : {}),
    messageType: message.messageType,
    content: message.content,
    createdAt: message.createdAt,
  };
}
