/**
 * gateway가 받은 클라이언트 이벤트를 backend 처리 경계로 넘기는 포트를 정의한다.
 *
 * 이 파일은 gateway가 비즈니스 로직을 직접 수행하지 않게 하는 핵심 경계다. room
 * 권한, 검증, 저장, 순번 부여 같은 판단은 이 포트 뒤의 main API 또는 message
 * service가 맡는다.
 */
import type { InboundClientEvent, InboundMessageResult } from '../contract'

export type InboundMessagePort = {
  /**
   * gateway가 클라이언트에게서 받은 이벤트를 backend 처리 경계로 넘긴다.
   *
   * gateway는 frame 크기, 파싱 가능 여부, 세션 존재 같은 전송 계층 수준의 확인만
   * 수행하고, room 권한, 메시지 저장, 순번 부여, 중복 제거 같은 제품 판단은 이
   * 포트 뒤의 main API 또는 message service가 맡는다.
   *
   * 반환값은 gateway가 송신자에게 즉시 ack 또는 error를 돌려줄지 판단하는 데
   * 사용될 수 있지만, 그 응답의 제품 의미는 app이 아니라 package/adapter 경계가
   * 정의해야 한다.
   */
  submit(input: InboundClientEvent): Promise<InboundMessageResult>
}
