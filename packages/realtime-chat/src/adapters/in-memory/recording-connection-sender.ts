/**
 * connection sender 포트의 기록용 구현이다.
 *
 * 이 파일은 실제 WebSocket 전송 없이 "어떤 세션에 어떤 이벤트를 보내려고 했는지"를
 * 검증하기 위한 테스트/초기 구현용 adapter다. socket lifecycle이나 backpressure
 * 처리는 실제 gateway socket adapter의 책임이다.
 */
import type { GatewaySession, RealtimeChatEvent } from '../../contract'
import type { ConnectionSenderPort } from '../../ports'

export type RecordedConnectionSend = {
  session: GatewaySession
  event: RealtimeChatEvent
}

export class RecordingConnectionSender implements ConnectionSenderPort {
  private readonly sentEvents: RecordedConnectionSend[] = []

  /**
   * 실제 socket 전송 대신 전송 요청을 메모리에 기록한다.
   *
   * gateway delivery runtime은 이 포트를 통해 "수신자 세션으로 이벤트를 보내라"는
   * 의도만 표현한다. 이 recording 구현은 WebSocket 라이브러리 없이도 어떤 세션에
   * 어떤 이벤트가 배달되려 했는지 검증할 수 있게 해준다.
   */
  async send(session: GatewaySession, event: RealtimeChatEvent): Promise<void> {
    this.sentEvents.push({ session, event })
  }

  /**
   * 기록된 전송 요청 목록의 복사본을 반환한다.
   *
   * 테스트는 이 반환값으로 배달 대상 sessionId, userId, event payload를 검증할 수
   * 있다. 내부 배열을 복사해 반환하므로 호출자가 배열을 변경해도 sender의 기록은
   * 유지된다.
   */
  getSentEvents(): RecordedConnectionSend[] {
    return [...this.sentEvents]
  }

  /**
   * 기록된 전송 요청을 모두 제거한다.
   *
   * 같은 sender 인스턴스로 여러 publish 시나리오를 검증할 때 이전 배달 기록이 다음
   * 검증에 섞이지 않도록 하는 테스트 편의 함수다.
   */
  clear(): void {
    this.sentEvents.length = 0
  }
}
