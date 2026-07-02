/**
 * 클라이언트가 웹소켓 게이트웨이에 접속하기 전에 사용하는 접속 티켓 계약을 정의한다.
 *
 * 이 파일은 티켓의 데이터 모양과 소비 결과만 표현한다. 티켓을 JWT로 만들지,
 * Redis nonce로 만들지, DB row로 만들지는 adapter 또는 backend 구현의 책임이다.
 */
export type GatewayTicket = {
  ticketId: string
  userId: string
  assignedGatewayId: string
  issuedAt: number
  expiresAt: number
}

export type IssueGatewayTicketInput = {
  userId: string
  assignedGatewayId: string
  ttlMs: number
  now?: number
}

export type ConsumeGatewayTicketInput = {
  ticketId: string
  gatewayId: string
  now?: number
}

export type ConsumeGatewayTicketResult =
  | {
      ok: true
      ticket: GatewayTicket
    }
  | {
      ok: false
      reason: 'not_found' | 'already_consumed' | 'expired' | 'gateway_mismatch'
    }
