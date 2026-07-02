/**
 * backend가 처리한 배달 이벤트를 gateway server group에 전달하는 이벤트 버스 포트를
 * 정의한다.
 *
 * 이 파일은 Redis/Kafka 같은 외부 브로커를 직접 고정하지 않는다. 1차 구현은
 * 인메모리 버스를 사용하고, 운영 확장 시 broker adapter만 바꿔 같은 publish/subscribe
 * 의미를 유지한다.
 */
import type { OutboundEvent } from '../contract'

export type OutboundEventHandler = (event: OutboundEvent) => Promise<void> | void

export type UnsubscribeOutboundEventHandler = () => Promise<void> | void

export type OutboundEventBusPort = {
  /**
   * backend 처리가 끝난 배달 이벤트를 gateway server group 쪽으로 발행한다.
   *
   * 1차 구현에서는 같은 프로세스 안의 in-memory bus가 이 역할을 한다. 이후 Redis
   * Pub/Sub, Kafka, durable stream으로 교체되더라도 호출자는 "배달 이벤트를 발행한다"
   * 는 의미만 유지한다.
   */
  publish(event: OutboundEvent): Promise<void>

  /**
   * gateway runtime이 배달 이벤트를 받을 handler를 등록한다.
   *
   * 반환되는 unsubscribe 함수는 graceful shutdown이나 테스트 정리 시 반드시 호출할
   * 수 있어야 한다. broker 구현체가 외부 연결을 사용하게 되면 이 함수는 consumer
   * 등록과 해제를 감싸는 경계가 된다.
   */
  subscribe(handler: OutboundEventHandler): Promise<UnsubscribeOutboundEventHandler> | UnsubscribeOutboundEventHandler
}
