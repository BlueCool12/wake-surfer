/**
 * gateway가 클라이언트에게서 받은 이벤트를 backend 처리 경계로 제출하는 유스케이스를
 * 정의한다.
 *
 * 이 파일은 socket frame을 제품 처리 경계로 넘기기 전, 현재 gateway에 유효한 세션인지
 * 확인하는 흐름만 소유한다. room 권한, 메시지 내용 검증, 저장, 순번 부여는
 * `InboundMessagePort` 뒤의 main API 또는 message service 책임이다.
 */
import type {
  InboundClientEvent,
  InboundMessageResult,
  RealtimeChatEvent,
} from '../contract'
import type {
  GatewaySessionRegistryPort,
  InboundMessagePort,
} from '../ports'

export type SubmitInboundClientEventUseCaseInput<TPayload = unknown> = {
  gatewayId: string
  sessionId: string
  event: RealtimeChatEvent<TPayload>
  receivedAt?: number
}

export type SubmitInboundClientEventUseCase = {
  /**
   * 클라이언트 이벤트를 현재 gateway session과 묶어 backend 처리 경계로 제출한다.
   *
   * sessionId가 registry에 없거나, 다른 gatewayId에 속한 세션이면 backend로 넘기지
   * 않고 구조화된 실패 결과를 반환한다. 이 검사는 제품 권한 검사가 아니라 gateway
   * local connection 정합성 검사다.
   */
  execute<TPayload = unknown>(
    input: SubmitInboundClientEventUseCaseInput<TPayload>,
  ): Promise<InboundMessageResult>
}

export type SubmitInboundClientEventUseCaseDeps = {
  sessionRegistry: GatewaySessionRegistryPort
  inboundMessagePort: InboundMessagePort
  now: () => number
}

/**
 * inbound client event 제출 유스케이스를 생성한다.
 *
 * gateway app은 WebSocket frame을 파싱한 뒤 이 유스케이스에 event와 sessionId만 넘기면
 * 된다. 세션 조회와 `InboundClientEvent` wrapping은 workflow가 맡아 app shell이
 * product data contract를 직접 조립하지 않게 한다.
 */
export function createSubmitInboundClientEventUseCase(
  deps: SubmitInboundClientEventUseCaseDeps,
): SubmitInboundClientEventUseCase {
  return {
    async execute<TPayload = unknown>(
      input: SubmitInboundClientEventUseCaseInput<TPayload>,
    ): Promise<InboundMessageResult> {
      const session = await deps.sessionRegistry.get(input.sessionId)

      if (!session) {
        return {
          accepted: false,
          code: 'SESSION_NOT_FOUND',
          message: 'gateway session was not found',
        }
      }

      if (session.gatewayId !== input.gatewayId) {
        return {
          accepted: false,
          code: 'GATEWAY_SESSION_MISMATCH',
          message: 'gateway session does not belong to this gateway',
        }
      }

      const inboundEvent: InboundClientEvent<TPayload> = {
        gatewayId: input.gatewayId,
        session,
        event: input.event,
        receivedAt: input.receivedAt ?? deps.now(),
      }

      return deps.inboundMessagePort.submit(inboundEvent)
    },
  }
}
