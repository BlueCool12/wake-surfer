/**
 * gateway 로컬 세션 registry 포트의 인메모리 구현이다.
 *
 * 이 파일은 "한 gateway 프로세스 안에서 어떤 userId가 어떤 sessionId들에 연결되어
 * 있는지"만 관리한다. 여러 gateway 사이의 공유 presence, 분산락, Redis 자료구조는
 * 이 파일의 책임이 아니다.
 */
import type {
  BindGatewaySessionInput,
  GatewaySession,
  UnbindGatewaySessionInput,
} from '../../contract'
import type { GatewaySessionRegistryPort } from '../../ports'

export type InMemoryGatewaySessionRegistryOptions = {
  sessionsById: Map<string, GatewaySession>
  sessionIdsByUserId: Map<string, Set<string>>
  createSessionIdSet: () => Set<string>
}

export class InMemoryGatewaySessionRegistry implements GatewaySessionRegistryPort {
  private readonly sessionsById: Map<string, GatewaySession>
  private readonly sessionIdsByUserId: Map<string, Set<string>>
  private readonly createSessionIdSet: () => Set<string>

  /**
   * 인메모리 세션 registry를 생성한다.
   *
   * 저장용 Map과 user index용 Set 생성 함수는 모두 외부에서 주입받는다. 이 adapter가
   * 내부에서 collection을 직접 만들지 않게 하여 테스트가 초기 상태를 구성할 수 있고,
   * composition root가 "어떤 저장 객체를 쓸지"를 명확히 결정하게 한다.
   */
  constructor(options: InMemoryGatewaySessionRegistryOptions) {
    this.sessionsById = options.sessionsById
    this.sessionIdsByUserId = options.sessionIdsByUserId
    this.createSessionIdSet = options.createSessionIdSet
  }

  /**
   * 로컬 gateway 프로세스가 보유한 연결 세션을 등록한다.
   *
   * 이 registry는 gateway 한 대의 메모리 상태만 표현한다. 여러 gateway 사이의
   * shared presence나 Redis registry를 흉내 내지 않는다. 따라서 같은 사용자가
   * 여러 디바이스나 탭으로 접속하면 같은 userId 아래 여러 sessionId가 저장된다.
   *
   * 같은 sessionId가 이미 있으면 이전 user index를 먼저 제거한다. 이 처리를 하지
   * 않으면 sessionId가 재사용되거나 테스트 fixture가 덮어써질 때 `findByUserId`가
   * 낡은 세션을 반환할 수 있다.
   */
  async bind(input: BindGatewaySessionInput): Promise<void> {
    const existing = this.sessionsById.get(input.sessionId)

    if (existing) {
      this.removeUserSessionIndex(existing.userId, existing.sessionId)
    }

    this.sessionsById.set(input.sessionId, input)
    this.addUserSessionIndex(input.userId, input.sessionId)
  }

  /**
   * 로컬 registry에서 세션을 제거하고 제거된 세션을 반환한다.
   *
   * gateway socket close, handshake 실패 후 정리, 테스트 teardown에서 사용한다.
   * 이미 제거된 세션에 대해 호출해도 에러를 던지지 않고 `undefined`를 반환한다.
   * 이렇게 두면 close 이벤트가 중복으로 들어와도 세션 정리 흐름이 깨지지 않는다.
   */
  async unbind(input: UnbindGatewaySessionInput): Promise<GatewaySession | undefined> {
    const session = this.sessionsById.get(input.sessionId)

    if (!session) {
      return undefined
    }

    this.sessionsById.delete(input.sessionId)
    this.removeUserSessionIndex(session.userId, session.sessionId)

    return session
  }

  /**
   * sessionId로 현재 로컬 gateway에 등록된 세션을 조회한다.
   *
   * 이 함수는 특정 socket frame을 처리할 때 "이 frame이 아직 유효한 세션에서 온
   * 것인지" 확인하는 데 쓸 수 있다. 조회 결과가 없다는 것은 해당 gateway 프로세스
   * 관점에서 더 이상 연결이 살아 있지 않다는 뜻이다.
   */
  async get(sessionId: string): Promise<GatewaySession | undefined> {
    return this.sessionsById.get(sessionId)
  }

  /**
   * userId에 연결된 모든 로컬 세션을 반환한다.
   *
   * outbound delivery runtime은 broker에서 `recipientUserId`가 포함된 이벤트를
   * 받으면 이 함수로 현재 gateway에 붙어 있는 수신자 세션들을 찾는다. 반환값은
   * 복사된 배열이므로 호출자가 배열을 변경해도 registry 내부 index는 변하지 않는다.
   */
  async findByUserId(userId: string): Promise<GatewaySession[]> {
    const sessionIds = this.sessionIdsByUserId.get(userId)

    if (!sessionIds) {
      return []
    }

    return [...sessionIds]
      .map((sessionId) => this.sessionsById.get(sessionId))
      .filter((session): session is GatewaySession => Boolean(session))
  }

  /**
   * userId -> sessionIds 보조 index에 세션 ID를 추가한다.
   *
   * primary storage는 `sessionsById`이고 이 index는 빠른 수신자 조회를 위한 보조
   * 구조다. 따라서 이 함수는 반드시 `sessionsById` 갱신과 같은 흐름에서만 호출되어야
   * 한다.
   */
  private addUserSessionIndex(userId: string, sessionId: string): void {
    const sessionIds = this.sessionIdsByUserId.get(userId) ?? this.createSessionIdSet()
    sessionIds.add(sessionId)
    this.sessionIdsByUserId.set(userId, sessionIds)
  }

  /**
   * userId -> sessionIds 보조 index에서 세션 ID를 제거한다.
   *
   * 특정 userId에 더 이상 세션이 남지 않으면 Map entry 자체를 삭제한다. 이렇게 해야
   * 장시간 실행되는 gateway 프로세스에서 빈 Set이 계속 누적되는 일을 피할 수 있다.
   */
  private removeUserSessionIndex(userId: string, sessionId: string): void {
    const sessionIds = this.sessionIdsByUserId.get(userId)

    if (!sessionIds) {
      return
    }

    sessionIds.delete(sessionId)

    if (sessionIds.size === 0) {
      this.sessionIdsByUserId.delete(userId)
    }
  }
}
