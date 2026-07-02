/**
 * realtime-chat port들의 public barrel이다.
 *
 * 앱과 adapter는 이 파일을 통해 package가 요구하는 외부 경계를 확인할 수 있다.
 * 이 파일은 포트 타입을 모아 내보내기만 하며, provider 선택이나 구현 정책을
 * 포함하지 않는다.
 */
export type { ConnectionSenderPort } from './connection-sender-port'
export type {
  ChatMessageRepositoryPort,
  ListMessagesAfterInput,
  PersistUserMessageInput,
  PersistUserMessageResult,
} from './chat-message-repository-port'
export type { GatewaySessionRegistryPort } from './gateway-session-registry-port'
export type { GatewayTicketPort } from './gateway-ticket-port'
export type { InboundMessagePort } from './inbound-message-port'
export type {
  OutboundEventBusPort,
  OutboundEventHandler,
  UnsubscribeOutboundEventHandler,
} from './outbound-event-bus-port'
export type { CanWriteChannelInput, PermissionPort } from './permission-port'
