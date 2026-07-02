/**
 * gateway 접속 티켓 포트의 인메모리 구현이다.
 *
 * 이 파일은 1차 구현과 테스트에서 Redis/DB 없이 presigned ticket 발급과 1회 소비
 * 흐름을 검증하기 위해 존재한다. 프로세스 재시작 시 상태가 사라지므로 운영용
 * 영속성이나 분산 원자성은 제공하지 않는다.
 */
import type {
  ConsumeGatewayTicketInput,
  ConsumeGatewayTicketResult,
  GatewayTicket,
  IssueGatewayTicketInput,
} from '../../contract'
import type { GatewayTicketPort } from '../../ports'

type StoredGatewayTicket = {
  consumed: boolean
  ticket: GatewayTicket
}

export type InMemoryGatewayTicketAdapterOptions = {
  generateTicketId: () => string
  generateRawTicket: () => string
  now: () => number
  tickets: Map<string, StoredGatewayTicket>
}

export class InMemoryGatewayTicketAdapter implements GatewayTicketPort {
  private readonly tickets: Map<string, StoredGatewayTicket>
  private readonly generateTicketId: () => string
  private readonly generateRawTicket: () => string
  private readonly now: () => number

  /**
   * 인메모리 티켓 저장소를 생성한다.
   *
   * `generateTicketId`와 `now`는 필수 주입이다. 티켓 ID 생성과 현재 시각은 운영 정책에
   * 가까운 결정이므로 adapter 내부에서 `Date.now`나 `Math.random`으로 fallback하지
   * 않는다. `tickets`도 외부에서 주입할 수 있게 두어 테스트가 저장 상태를 직접 구성할
   * 수 있고, adapter 내부의 객체 생성 지점을 줄인다.
   */
  constructor(options: InMemoryGatewayTicketAdapterOptions) {
    this.tickets = options.tickets
    this.generateTicketId = options.generateTicketId
    this.generateRawTicket = options.generateRawTicket
    this.now = options.now
  }

  /**
   * 지정된 사용자와 gateway에 묶인 짧은 수명의 접속 티켓을 발급한다.
   *
   * 이 함수는 아직 실제 인증을 수행하지 않는다. 인증은 main API 쪽의 상위 흐름에서
   * 끝났다고 보고, 이 adapter는 "이미 인증된 사용자가 어느 gateway에 접속할 수
   * 있는지"를 표현하는 티켓만 만든다.
   *
   * 발급된 티켓은 내부 Map에 `consumed: false` 상태로 저장된다. 이 상태는 웹소켓
   * handshake에서 `consume`이 성공할 때 `true`로 바뀌며, 같은 티켓의 재사용을
   * 막는 기준이 된다.
   */
  async issue(input: IssueGatewayTicketInput): Promise<GatewayTicket> {
    const issuedAt = input.now ?? this.now()
    const rawTicket = this.generateRawTicket()
    const ticket: GatewayTicket = {
      ticketId: this.generateTicketId(),
      rawTicket,
      userId: input.userId,
      assignedGatewayId: input.assignedGatewayId,
      issuedAt,
      expiresAt: issuedAt + input.ttlMs,
    }

    this.tickets.set(rawTicket, {
      consumed: false,
      ticket: {
        ticketId: ticket.ticketId,
        userId: ticket.userId,
        assignedGatewayId: ticket.assignedGatewayId,
        issuedAt: ticket.issuedAt,
        expiresAt: ticket.expiresAt,
      },
    })

    return ticket
  }

  /**
   * 웹소켓 handshake 시점에 티켓을 검증하고 1회 소비 처리한다.
   *
   * 검증 순서는 의도적으로 명확하게 나뉘어 있다.
   * 먼저 존재하지 않는 티켓을 거르고, 이미 소비된 티켓을 거른 뒤, 만료 여부와
   * gateway 배정 불일치를 확인한다. 이렇게 실패 이유를 쪼개면 gateway app은
   * 제품 판단을 하지 않고도 운영 로그에서 원인을 구분할 수 있다.
   *
   * 성공 시에는 `consumed`를 `true`로 바꾼 뒤 티켓을 반환한다. 이 adapter는
   * in-memory 구현이라 프로세스 재시작 후 상태가 사라진다. 그 한계는 1차 구현의
   * 의도된 제약이며, 나중에 Redis `GETDEL` 같은 원자적 소비 연산으로 교체할 수
   * 있도록 포트 계약을 유지한다.
   */
  async consume(input: ConsumeGatewayTicketInput): Promise<ConsumeGatewayTicketResult> {
    const stored = this.tickets.get(input.rawTicket)

    if (!stored) {
      return { ok: false, reason: 'not_found' }
    }

    if (stored.consumed) {
      return { ok: false, reason: 'already_consumed' }
    }

    const now = input.now ?? this.now()

    if (stored.ticket.expiresAt <= now) {
      return { ok: false, reason: 'expired' }
    }

    if (stored.ticket.assignedGatewayId !== input.gatewayId) {
      return { ok: false, reason: 'gateway_mismatch' }
    }

    stored.consumed = true

    return {
      ok: true,
      ticket: stored.ticket,
    }
  }
}
