import { MessageTargetSchema } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  ActorId,
  ClientMessageId,
  CommandId,
  MessageId,
  PublicMessage,
  SendMessageContent,
  SendMessageResponse,
  SendMessageTarget,
  StreamId,
} from "@wake-surfer/realtime-chat-message-send-contracts";

export type MessageIdGenerator = {
  generate: () => MessageId;
};

export type OutboundEventIdGenerator = {
  generate: () => string;
};

export function assertActorId(actorId: ActorId): void {
  assertNonBlankString(actorId, "actorId");
}

export function assertClientMessageId(clientMessageId: ClientMessageId): void {
  assertNonBlankString(clientMessageId, "clientMessageId");
}

export function assertMessageId(messageId: MessageId): void {
  assertNonBlankString(messageId, "messageId");
}

export function assertStreamId(streamId: StreamId): void {
  assertNonBlankString(streamId, "streamId");
}

export function assertMessageTarget(target: unknown): asserts target is SendMessageTarget {
  if (!MessageTargetSchema.safeParse(target).success) {
    throw new Error("message target이 올바르지 않습니다.");
  }
}

export function assertMessageContent(content: SendMessageContent): void {
  if (content.type !== "text") {
    throw new Error("지원하지 않는 메시지 content type입니다.");
  }

  if (content.text.trim().length === 0) {
    throw new Error("메시지 text는 비어 있지 않은 문자열이어야 합니다.");
  }
}

export function createAcceptedResponse(input: {
  command: {
    commandId?: CommandId;
    clientMessageId: ClientMessageId;
  };
  message: PublicMessage;
}): SendMessageResponse {
  const response: SendMessageResponse = {
    status: "accepted",
    clientMessageId: input.command.clientMessageId,
    message: input.message,
  };

  if (input.command.commandId !== undefined) {
    response.commandId = input.command.commandId;
  }

  return response;
}

export const createDefaultMessageIdGenerator = (): MessageIdGenerator => ({
  generate() {
    return `msg_${globalThis.crypto.randomUUID()}`;
  },
});

export const createDefaultOutboundEventIdGenerator = (): OutboundEventIdGenerator => ({
  generate() {
    return `evt_${globalThis.crypto.randomUUID()}`;
  },
});

function assertNonBlankString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName}는 비어 있지 않은 문자열이어야 합니다.`);
  }
}
