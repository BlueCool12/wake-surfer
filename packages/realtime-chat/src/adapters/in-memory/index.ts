/**
 * 인메모리/mock adapter들의 public barrel이다.
 *
 * 이 파일은 1차 구현과 테스트에서 사용할 기본 adapter들을 한곳에서 내보낸다.
 * 운영용 provider adapter가 생기더라도 이 파일의 책임은 in-memory 계열 export로
 * 제한한다.
 */
export {
  InMemoryGatewayTicketAdapter,
  type InMemoryGatewayTicketAdapterOptions,
} from './in-memory-gateway-ticket-adapter'
export {
  InMemoryGatewaySessionRegistry,
  type InMemoryGatewaySessionRegistryOptions,
} from './in-memory-gateway-session-registry'
export {
  InMemoryOutboundEventBus,
  type InMemoryOutboundEventBusOptions,
} from './in-memory-outbound-event-bus'
export {
  MockInboundMessageClient,
  type MockInboundMessageHandler,
} from './mock-inbound-message-client'
export {
  RecordingConnectionSender,
  type RecordedConnectionSend,
} from './recording-connection-sender'
