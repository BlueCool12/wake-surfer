/**
 * gateway가 클라이언트에게서 받은 이벤트를 backend 처리 경계로 넘길 때 사용하는
 * inbound 계약을 정의한다.
 *
 * 이 파일은 "어떤 gateway 세션에서 어떤 이벤트가 들어왔는지"를 전달하기 위한
 * 데이터 모양만 소유한다. 메시지를 허용할지, 저장할지, 어떤 ack를 만들지는
 * 이 계약 뒤의 workflow 또는 backend adapter가 결정한다.
 */
import type { GatewaySession } from './gateway-session'
import type { RealtimeChatEvent } from './realtime-chat-event'

export type InboundClientEvent<TPayload = unknown> = {
  gatewayId: string
  session: GatewaySession
  event: RealtimeChatEvent<TPayload>
  receivedAt: number
}

export type InboundMessageResult =
  | {
      accepted: true
      ackEvent?: RealtimeChatEvent
    }
  | {
      accepted: false
      code: string
      message: string
    }
