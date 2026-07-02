/**
 * inbound message 포트의 mock 구현이다.
 *
 * 이 파일은 gateway가 받은 이벤트를 main API 또는 message service로 넘기는 경계를
 * 테스트하기 위해 존재한다. 실제 HTTP/gRPC 호출, DB 저장, 권한 검증은 여기서 하지
 * 않는다.
 */
import type { InboundClientEvent, InboundMessageResult } from '../../contract'
import type { InboundMessagePort } from '../../ports'

export type MockInboundMessageHandler = (input: InboundClientEvent) => Promise<InboundMessageResult> | InboundMessageResult

export class MockInboundMessageClient implements InboundMessagePort {
  private readonly submittedEvents: InboundClientEvent[] = []
  private readonly handler?: MockInboundMessageHandler

  /**
   * inbound message mock을 생성한다.
   *
   * `handler`를 넘기면 테스트나 로컬 시뮬레이션에서 main API/message service의 응답을
   * 원하는 대로 흉내 낼 수 있다. 넘기지 않으면 모든 inbound event를 accepted로
   * 처리해 gateway wiring 자체만 검증할 수 있게 한다.
   */
  constructor(handler?: MockInboundMessageHandler) {
    this.handler = handler
  }

  /**
   * gateway에서 들어온 클라이언트 이벤트를 기록하고 mock backend 응답을 반환한다.
   *
   * 실제 구현에서는 이 함수 뒤가 내부 HTTP/gRPC 호출, queue publish, 또는 message
   * service command 호출이 될 수 있다. 이 mock은 그런 외부 경로를 붙이기 전까지
   * "gateway가 이벤트를 backend 처리 경계로 넘겼는지"를 검증하기 위한 기록 저장소로
   * 동작한다.
   */
  async submit(input: InboundClientEvent): Promise<InboundMessageResult> {
    this.submittedEvents.push(input)

    if (this.handler) {
      return this.handler(input)
    }

    return { accepted: true }
  }

  /**
   * 지금까지 submit된 inbound event 목록의 복사본을 반환한다.
   *
   * 내부 배열을 그대로 노출하지 않는 이유는 테스트 코드가 반환된 배열을 조작하더라도
   * mock adapter의 기록 상태가 오염되지 않게 하기 위해서다.
   */
  getSubmittedEvents(): InboundClientEvent[] {
    return [...this.submittedEvents]
  }

  /**
   * 기록된 inbound event를 모두 제거한다.
   *
   * 하나의 mock 인스턴스를 여러 테스트 단계에서 재사용할 때 이전 단계의 기록이 다음
   * 검증에 섞이지 않도록 명시적으로 초기화하는 용도다.
   */
  clear(): void {
    this.submittedEvents.length = 0
  }
}
