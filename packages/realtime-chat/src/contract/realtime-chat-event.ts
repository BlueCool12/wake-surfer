/**
 * 실시간 채팅에서 transport를 타고 오가는 application-level event 계약을 정의한다.
 *
 * 이 파일은 WebSocket, broker, backend 처리 경계가 공통으로 이해해야 하는 이벤트
 * envelope의 모양만 소유한다. room 권한, 메시지 저장, 순번 발급 방식 같은 제품
 * 규칙은 이 타입에 넣지 않는다.
 */
export type RealtimeChatEventType =
  | 'room.join'
  | 'room.leave'
  | 'chat.message'
  | 'chat.ack'
  | 'presence.update'
  | 'typing.start'
  | 'typing.stop'
  | 'resume'
  | 'error'

export type RealtimeChatEvent<TPayload = unknown> = {
  v: 1
  type: RealtimeChatEventType
  eventId: string
  roomId: string
  senderId: string
  sessionId: string
  clientMsgId?: string
  serverSeq?: number
  sentAt: number
  payload: TPayload
}

export type DeliveryEvent<TPayload = unknown> = {
  deliveryId: string
  recipientUserId: string
  targetGatewayId?: string
  event: RealtimeChatEvent<TPayload>
  publishedAt: number
}

export type OutboundMessageDeliveryRequested = {
  type: 'OutboundMessageDeliveryRequested'
  deliveryId: string
  messageId: string
  streamId: string
  sequence: number
  publishedAt: number
}

export type OutboundEvent<TPayload = unknown> =
  | DeliveryEvent<TPayload>
  | OutboundMessageDeliveryRequested
