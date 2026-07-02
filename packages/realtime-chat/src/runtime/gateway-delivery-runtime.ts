/**
 * gateway 노드가 outbound delivery event를 받아 로컬 연결 세션으로 전달하는 runtime을
 * 정의한다.
 *
 * 이 파일은 브로커 구독, 로컬 세션 조회, sender 호출을 연결하는 wiring만 맡는다.
 * 메시지 권한, 저장, 순번 부여, 중복 제거 같은 제품 판단은 backend 처리 경계의
 * 책임이며 여기서 수행하지 않는다.
 */
import type {
  DeliveryEvent,
  GatewaySession,
  OutboundEvent,
} from '../contract'
import type {
  ConnectionSenderPort,
  GatewaySessionRegistryPort,
  OutboundEventBusPort,
  UnsubscribeOutboundEventHandler,
} from '../ports'

export type GatewayDeliveryRuntime = {
  /**
   * outbound event bus 구독을 시작한다.
   *
   * start는 idempotent하게 동작해야 한다. 이미 구독 중이면 추가 구독을 만들지 않고
   * 그대로 반환한다. 이렇게 해야 gateway app의 lifecycle hook이 중복 호출되어도
   * 같은 delivery event가 여러 번 전송되는 일을 피할 수 있다.
   */
  start(): Promise<void>

  /**
   * outbound event bus 구독을 해제한다.
   *
   * gateway graceful shutdown, 테스트 teardown, runtime 재시작 시 호출된다. 이미
   * 중지된 상태에서 호출해도 에러를 내지 않는다.
   */
  stop(): Promise<void>
}

export type GatewayDeliveryError = {
  error: unknown
  delivery: DeliveryEvent
  session: GatewaySession
}

export type GatewayDeliveryRuntimeOptions = {
  gatewayId: string
  eventBus: OutboundEventBusPort
  sessionRegistry: GatewaySessionRegistryPort
  sender: ConnectionSenderPort
  onDeliveryError?: (error: GatewayDeliveryError) => Promise<void> | void
}

/**
 * gateway server group의 한 노드에서 outbound delivery를 처리하는 runtime을 만든다.
 *
 * 이 runtime은 비즈니스 로직을 수행하지 않는다. broker 역할의 `eventBus`에서
 * delivery event를 받으면, 현재 gateway의 local session registry에서 수신자 세션을
 * 찾고, `sender` 포트를 통해 해당 세션으로 이벤트를 전달한다.
 *
 * 이 함수가 gatewayId를 옵션으로 받는 이유는 하나의 broker 이벤트가 여러 gateway에
 * 전파되는 구조를 표현하기 위해서다. `targetGatewayId`가 없는 이벤트는 모든 gateway가
 * 확인할 수 있고, 각 gateway는 자기 로컬 세션에 수신자가 있을 때만 전송한다.
 * `targetGatewayId`가 있으면 해당 gateway만 처리한다.
 */
export function createGatewayDeliveryRuntime(options: GatewayDeliveryRuntimeOptions): GatewayDeliveryRuntime {
  let unsubscribe: UnsubscribeOutboundEventHandler | undefined

  return {
    /**
     * outbound event bus에 delivery handler를 등록한다.
     *
     * 등록된 handler는 event bus에서 delivery event가 발행될 때마다
     * `deliverToLocalSessions`를 호출한다. start가 여러 번 호출되어도 첫 구독만
     * 유지하므로, 같은 gateway runtime이 동일 이벤트를 중복 처리하지 않는다.
     */
    async start(): Promise<void> {
      if (unsubscribe) {
        return
      }

      unsubscribe = await options.eventBus.subscribe(async (delivery) => {
        if (isLegacyDeliveryEvent(delivery)) {
          await deliverToLocalSessions(options, delivery)
        }
      })
    },

    /**
     * start에서 등록한 delivery handler 구독을 해제한다.
     *
     * unsubscribe 함수는 event bus adapter가 반환한 정리 함수다. in-memory adapter에서는
     * Set에서 handler를 제거하고, 나중에 Redis/Kafka adapter가 생기면 consumer 해제나
     * connection cleanup을 감싸게 된다.
     */
    async stop(): Promise<void> {
      if (!unsubscribe) {
        return
      }

      await unsubscribe()
      unsubscribe = undefined
    },
  }
}

function isLegacyDeliveryEvent(event: OutboundEvent): event is DeliveryEvent {
  return 'recipientUserId' in event
}

/**
 * 하나의 delivery event를 현재 gateway의 로컬 세션들로 배달한다.
 *
 * 처리 순서는 의도적으로 단순하다.
 *
 * 1. `targetGatewayId`가 있고 현재 gateway와 다르면 즉시 무시한다.
 * 2. 수신자 userId로 현재 gateway registry에 있는 로컬 세션들을 조회한다.
 * 3. 조회된 세션 중 현재 gatewayId에 속한 세션에만 sender를 호출한다.
 * 4. 개별 세션 전송 실패는 전체 배달 루프를 중단하지 않고 `onDeliveryError`로 넘긴다.
 *
 * 이 함수는 room 권한, 메시지 저장, 순번 보장, 중복 제거를 판단하지 않는다. 그런
 * 제품 판단은 inbound 처리 경계나 backend message service의 책임이다.
 */
async function deliverToLocalSessions(
  options: GatewayDeliveryRuntimeOptions,
  delivery: DeliveryEvent,
): Promise<void> {
  if (delivery.targetGatewayId && delivery.targetGatewayId !== options.gatewayId) {
    return
  }

  const sessions = await options.sessionRegistry.findByUserId(delivery.recipientUserId)

  for (const session of sessions) {
    if (session.gatewayId !== options.gatewayId) {
      continue
    }

    try {
      await options.sender.send(session, delivery.event)
    } catch (error) {
      await options.onDeliveryError?.({
        error,
        delivery,
        session,
      })
    }
  }
}
