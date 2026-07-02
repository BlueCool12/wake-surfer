/**
 * gateway 프로세스의 로컬 연결 세션 저장소 포트를 정의한다.
 *
 * 이 파일은 `userId -> session[]` 조회 의미를 고정하지만, 저장 방식은 고정하지
 * 않는다. 1차 구현은 인메모리 registry를 사용하고, 이후 shared presence registry가
 * 필요해지면 이 포트의 adapter를 교체한다.
 */
import type {
  BindGatewaySessionInput,
  GatewaySession,
  UnbindGatewaySessionInput,
} from '../contract'

export type GatewaySessionRegistryPort = {
  /**
   * 현재 게이트웨이 프로세스가 보유한 로컬 연결 세션을 등록한다.
   *
   * 같은 `sessionId`가 이미 등록되어 있으면 구현체는 새 입력으로 교체해야 한다.
   * 이 동작은 재연결, 중복 handshake, 테스트 fixture 교체 상황에서 registry가
   * 낡은 user index를 들고 있지 않도록 하기 위한 기준이다.
   */
  bind(input: BindGatewaySessionInput): Promise<void>

  /**
   * 로컬 연결 세션을 제거하고, 제거된 세션 정보를 반환한다.
   *
   * 반환값은 close handler가 정리 로그를 남기거나 presence 후속 처리를 트리거할 때
   * 사용할 수 있다. 이미 없는 세션을 제거하려는 경우에는 idempotent하게
   * `undefined`를 반환한다.
   */
  unbind(input: UnbindGatewaySessionInput): Promise<GatewaySession | undefined>

  /**
   * `sessionId`로 단일 로컬 세션을 조회한다.
   *
   * 이 함수는 gateway가 특정 연결의 상태를 확인해야 할 때 사용한다. 예를 들어
   * 클라이언트 frame을 받은 뒤 해당 socket이 아직 유효한 세션에 묶여 있는지
   * 확인하는 용도다.
   */
  get(sessionId: string): Promise<GatewaySession | undefined>

  /**
   * 한 사용자에게 연결된 모든 로컬 세션을 조회한다.
   *
   * 채팅 클라이언트는 브라우저 탭, 모바일 앱, 데스크톱 앱처럼 여러 연결을 동시에
   * 가질 수 있으므로 `userId -> session` 단일 매핑으로 제한하지 않는다. gateway
   * delivery runtime은 이 함수로 수신자의 로컬 세션들을 찾은 뒤 각각에 이벤트를
   * 전송한다.
   */
  findByUserId(userId: string): Promise<GatewaySession[]>
}
