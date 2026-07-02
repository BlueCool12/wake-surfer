/**
 * outbound event bus 포트의 인메모리 구현이다.
 *
 * 이 파일은 실제 메시지 브로커를 붙이기 전까지 publish/subscribe 흐름을 같은
 * 프로세스 안에서 검증하기 위한 adapter다. Redis Pub/Sub, Kafka, durable stream의
 * delivery semantics를 흉내 내지 않는다.
 */
import type { DeliveryEvent } from '../../contract'
import type {
  OutboundEventBusPort,
  OutboundEventHandler,
  UnsubscribeOutboundEventHandler,
} from '../../ports'

export type InMemoryOutboundEventBusOptions = {
  handlers: Set<OutboundEventHandler>
}

export class InMemoryOutboundEventBus implements OutboundEventBusPort {
  private readonly handlers: Set<OutboundEventHandler>

  /**
   * 인메모리 outbound event bus를 생성한다.
   *
   * handler Set은 외부에서 주입받는다. 이렇게 두면 테스트나 composition root가 bus의
   * 초기 구독 상태를 직접 구성할 수 있고, adapter 내부의 객체 생성 지점도 제거된다.
   */
  constructor(options: InMemoryOutboundEventBusOptions) {
    this.handlers = options.handlers
  }

  /**
   * 등록된 모든 gateway-side handler에게 배달 이벤트를 순차적으로 전달한다.
   *
   * 이 구현은 실제 broker가 아니라 같은 프로세스 안에서 동작하는 테스트/초기 구현용
   * event bus다. handler를 배열로 복사한 뒤 순회하므로, publish 도중 어떤 handler가
   * unsubscribe되어도 현재 publish 루프의 순회 상태가 깨지지 않는다.
   *
   * handler 중 하나가 에러를 던지면 이 함수도 reject된다. 운영용 broker adapter를
   * 만들 때는 retry, dead-letter, ack 정책을 별도로 정의해야 한다.
   */
  async publish(event: DeliveryEvent): Promise<void> {
    for (const handler of [...this.handlers]) {
      await handler(event)
    }
  }

  /**
   * 배달 이벤트를 받을 handler를 등록하고 해제 함수를 반환한다.
   *
   * gateway delivery runtime은 start 시점에 이 함수를 호출하고, graceful shutdown이나
   * 테스트 종료 시 반환된 함수를 호출해 구독을 해제한다. 반환 함수는 여러 번 호출돼도
   * Set 삭제 특성상 안전하게 동작한다.
   */
  subscribe(handler: OutboundEventHandler): UnsubscribeOutboundEventHandler {
    this.handlers.add(handler)

    return () => {
      this.handlers.delete(handler)
    }
  }
}
