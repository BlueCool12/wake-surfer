/**
 * gateway runtime이 실제 socket 라이브러리를 몰라도 로컬 연결로 이벤트를 보낼 수
 * 있게 하는 전송 포트를 정의한다.
 *
 * 이 파일은 WebSocket 구현체 타입을 소유하지 않는다. 실제 `socket.send` 호출은
 * gateway app 또는 socket adapter가 맡고, package는 이 포트를 통해 배달 의도만
 * 표현한다.
 */
import type { GatewaySession, RealtimeChatEvent } from '../contract'

export type ConnectionSenderPort = {
  /**
   * 게이트웨이 로컬 메모리에 살아 있는 특정 연결 세션으로 이벤트를 전송한다.
   *
   * 이 포트는 실제 WebSocket 객체나 런타임 라이브러리 타입을 package 경계 밖으로
   * 새지 않게 하기 위한 추상화다. gateway runtime은 `GatewaySession`과
   * `RealtimeChatEvent`만 알고, 실제 `socket.send(...)` 호출 방식은 app 또는
   * adapter가 결정한다.
   *
   * 구현체는 이 함수 안에서 전송 실패를 감지할 수 있다. 다만 실패 후 세션 정리,
   * 재시도, dead-letter 처리 같은 정책은 구현체 또는 상위 runtime의 명시적인
   * 에러 처리 경계에서 다뤄야 한다.
   */
  send(session: GatewaySession, event: RealtimeChatEvent): Promise<void>
}
