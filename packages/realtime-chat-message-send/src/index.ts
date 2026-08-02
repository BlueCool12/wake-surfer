export {
  createDefaultMessageTargetResolver,
  createMessageSendModule,
  type CreateMessageSendModuleConfig,
  type MessageSendModule,
  type MessageTargetResolution,
  type MessageTargetResolver,
  type MessageWriteAuthorization,
  type MessageWriteAuthorizer,
} from "./message-send-module";
export {
  createDefaultMessageIdGenerator,
  createDefaultOutboundEventIdGenerator,
  toChatMessage,
  type AppendedTextMessage,
  type MessageIdGenerator,
  type OutboundEventIdGenerator,
  type SendMessageIdempotencyKey,
  type SendMessageInput,
  type SendMessageResult,
} from "./message-send";
export {
  getCanonicalStreamId,
  getMessageTargetId as getTargetId,
  getMessageTargetType as getTargetType,
} from "@wake-surfer/realtime-chat-message-contracts";
