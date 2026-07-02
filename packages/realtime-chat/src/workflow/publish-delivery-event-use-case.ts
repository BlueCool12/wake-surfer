/**
 * backend 처리가 끝난 이벤트를 gateway server group으로 발행하는 유스케이스를 정의한다.
 *
 * 이 파일은 main API 또는 message service가 메시지 저장/검증을 끝낸 뒤 "이 이벤트를
 * 어떤 사용자에게 배달하라"는 delivery event를 만드는 흐름을 소유한다. 실제 broker가
 * 인메모리인지 Redis인지 Kafka인지는 `OutboundEventBusPort` 구현체의 책임이다.
 */
import type { DeliveryEvent, RealtimeChatEvent } from '../contract'
import type { OutboundEventBusPort } from '../ports'

export type PublishDeliveryEventUseCaseInput<TPayload = unknown> = {
  recipientUserId: string
  targetGatewayId?: string
  event: RealtimeChatEvent<TPayload>
  deliveryId?: string
  publishedAt?: number
}

export type PublishDeliveryEventUseCase = {
  /**
   * 배달 이벤트를 만들고 outbound event bus에 발행한다.
   *
   * `targetGatewayId`가 없으면 모든 gateway가 이벤트를 확인하고, 각 gateway는 자기
   * 로컬 세션에 수신자가 있을 때만 전송한다. `targetGatewayId`가 있으면 특정 gateway
   * 노드만 처리하는 최적화 경로를 표현한다.
   */
  execute<TPayload = unknown>(
    input: PublishDeliveryEventUseCaseInput<TPayload>,
  ): Promise<DeliveryEvent<TPayload>>
}

export type PublishDeliveryEventUseCaseDeps = {
  eventBus: OutboundEventBusPort
  generateDeliveryId: () => string
  now: () => number
}

/**
 * delivery event 발행 유스케이스를 생성한다.
 *
 * 이 유스케이스는 deliveryId와 publishedAt을 채운 뒤 event bus에 publish한다. ID와
 * 시간 생성 함수를 주입받기 때문에 테스트에서 결정적인 값을 사용할 수 있고, 운영
 * 환경에서는 별도 ID 생성 전략으로 교체할 수 있다.
 */
export function createPublishDeliveryEventUseCase(
  deps: PublishDeliveryEventUseCaseDeps,
): PublishDeliveryEventUseCase {
  return {
    async execute<TPayload = unknown>(
      input: PublishDeliveryEventUseCaseInput<TPayload>,
    ): Promise<DeliveryEvent<TPayload>> {
      const delivery: DeliveryEvent<TPayload> = {
        deliveryId: input.deliveryId ?? deps.generateDeliveryId(),
        recipientUserId: input.recipientUserId,
        targetGatewayId: input.targetGatewayId,
        event: input.event,
        publishedAt: input.publishedAt ?? deps.now(),
      }

      await deps.eventBus.publish(delivery)

      return delivery
    },
  }
}
