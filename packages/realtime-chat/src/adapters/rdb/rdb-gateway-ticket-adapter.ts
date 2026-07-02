import type {
  ConsumeGatewayTicketInput,
  ConsumeGatewayTicketResult,
  GatewayTicket,
  IssueGatewayTicketInput,
} from '../../contract'
import type { GatewayTicketPort } from '../../ports'

export type GatewayTicketHash = (rawTicket: string) => Promise<string> | string

export type RdbGatewayTicketRow = {
  ticketId: string
  userId: string
  assignedGatewayId: string
  issuedAt: number
  expiresAt: number
}

export type InsertGatewayTicketHashInput = {
  ticketId: string
  ticketHash: string
  userId: string
  assignedGatewayId: string
  issuedAt: number
  expiresAt: number
}

export type ConsumeGatewayTicketHashInput = {
  ticketHash: string
  gatewayId: string
  now: number
  consumedAt: number
}

export type ConsumeGatewayTicketHashResult =
  | {
      ok: true
      row: RdbGatewayTicketRow
    }
  | {
      ok: false
      reason: 'not_found' | 'already_consumed' | 'expired' | 'gateway_mismatch'
    }

export type RdbGatewayTicketRepository = {
  /**
   * Stores the hash only. Raw ticket values must never be persisted by this repository.
   */
  insertTicketHash(input: InsertGatewayTicketHashInput): Promise<void>

  /**
   * Atomically consumes one unexpired ticket by hash.
   *
   * A concrete RDB implementation should model this as an update constrained by
   * `consumed_at IS NULL AND expires_at > now`; success means exactly one row was affected.
   */
  consumeTicketHash(input: ConsumeGatewayTicketHashInput): Promise<ConsumeGatewayTicketHashResult>
}

export type RdbGatewayTicketAdapterOptions = {
  repository: RdbGatewayTicketRepository
  hashTicket: GatewayTicketHash
  generateTicketId: () => string
  generateRawTicket: () => string
  now: () => number
}

export class RdbGatewayTicketAdapter implements GatewayTicketPort {
  private readonly repository: RdbGatewayTicketRepository
  private readonly hashTicket: GatewayTicketHash
  private readonly generateTicketId: () => string
  private readonly generateRawTicket: () => string
  private readonly now: () => number

  constructor(options: RdbGatewayTicketAdapterOptions) {
    this.repository = options.repository
    this.hashTicket = options.hashTicket
    this.generateTicketId = options.generateTicketId
    this.generateRawTicket = options.generateRawTicket
    this.now = options.now
  }

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

    await this.repository.insertTicketHash({
      ticketId: ticket.ticketId,
      ticketHash: await this.hashTicket(rawTicket),
      userId: ticket.userId,
      assignedGatewayId: ticket.assignedGatewayId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
    })

    return ticket
  }

  async consume(input: ConsumeGatewayTicketInput): Promise<ConsumeGatewayTicketResult> {
    const now = input.now ?? this.now()
    const consumed = await this.repository.consumeTicketHash({
      ticketHash: await this.hashTicket(input.rawTicket),
      gatewayId: input.gatewayId,
      now,
      consumedAt: now,
    })

    if (!consumed.ok) {
      return consumed
    }

    return {
      ok: true,
      ticket: {
        ticketId: consumed.row.ticketId,
        userId: consumed.row.userId,
        assignedGatewayId: consumed.row.assignedGatewayId,
        issuedAt: consumed.row.issuedAt,
        expiresAt: consumed.row.expiresAt,
      },
    }
  }
}
