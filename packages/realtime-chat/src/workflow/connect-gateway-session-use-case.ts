/**
 * 웹소켓 handshake에서 접속 티켓을 소비하고 로컬 gateway 세션을 등록하는 유스케이스를
 * 정의한다.
 *
 * 이 파일은 gateway app이 티켓 검증 포트와 세션 registry 포트를 어떤 순서로 호출해야
 * 하는지 숨긴다. 실제 WebSocket accept, close 이벤트, socket 객체 관리는 app 또는
 * socket adapter의 책임이다.
 */
import type {
  ConsumeGatewayTicketResult,
  GatewaySession,
  GatewayTicket,
} from '../contract'
import type {
  GatewaySessionRegistryPort,
  GatewayTicketPort,
} from '../ports'

export type ConnectGatewaySessionUseCaseInput = {
  ticketId: string
  gatewayId: string
  metadata?: Record<string, unknown>
  now?: number
}

export type ConnectGatewaySessionUseCaseResult =
  | {
      ok: true
      ticket: GatewayTicket
      session: GatewaySession
    }
  | {
      ok: false
      reason: Extract<ConsumeGatewayTicketResult, { ok: false }>['reason']
    }

export type ConnectGatewaySessionUseCase = {
  /**
   * 접속 티켓을 검증/소비한 뒤 gateway local session을 등록한다.
   *
   * 티켓 소비가 실패하면 세션은 등록하지 않는다. 성공하면 티켓의 userId와 입력의
   * gatewayId를 사용해 `GatewaySession`을 만들고 registry에 bind한다.
   */
  execute(input: ConnectGatewaySessionUseCaseInput): Promise<ConnectGatewaySessionUseCaseResult>
}

export type ConnectGatewaySessionUseCaseDeps = {
  ticketPort: GatewayTicketPort
  sessionRegistry: GatewaySessionRegistryPort
  generateSessionId: () => string
  now: () => number
}

/**
 * gateway handshake 연결 유스케이스를 생성한다.
 *
 * `generateSessionId`와 `now`를 주입받는 이유는 gateway app이 세션 ID 생성 방식과
 * 시간 기준을 제어할 수 있게 하기 위해서다. 이 유스케이스는 티켓 소비와 세션 등록의
 * 순서만 책임지고, 세션 ID의 포맷이나 운영 정책을 고정하지 않는다.
 */
export function createConnectGatewaySessionUseCase(
  deps: ConnectGatewaySessionUseCaseDeps,
): ConnectGatewaySessionUseCase {
  return {
    async execute(input: ConnectGatewaySessionUseCaseInput): Promise<ConnectGatewaySessionUseCaseResult> {
      const consumed = await deps.ticketPort.consume({
        ticketId: input.ticketId,
        gatewayId: input.gatewayId,
        now: input.now,
      })

      if (!consumed.ok) {
        return {
          ok: false,
          reason: consumed.reason,
        }
      }

      const connectedAt = input.now ?? deps.now()
      const session: GatewaySession = {
        sessionId: deps.generateSessionId(),
        userId: consumed.ticket.userId,
        gatewayId: input.gatewayId,
        connectedAt,
        metadata: input.metadata,
      }

      await deps.sessionRegistry.bind(session)

      return {
        ok: true,
        ticket: consumed.ticket,
        session,
      }
    },
  }
}
