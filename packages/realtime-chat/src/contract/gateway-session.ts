/**
 * 웹소켓 게이트웨이 한 대가 로컬 메모리에 보관하는 연결 세션 계약을 정의한다.
 *
 * 이 세션은 로그인 세션이나 영속 사용자 상태가 아니다. 특정 gateway 프로세스에
 * 현재 연결되어 있는 socket/session 매핑을 표현하기 위한 최소 데이터다.
 */
export type GatewaySession = {
  sessionId: string
  userId: string
  gatewayId: string
  connectedAt: number
  metadata?: Record<string, unknown>
}

export type BindGatewaySessionInput = GatewaySession

export type UnbindGatewaySessionInput = {
  sessionId: string
}
