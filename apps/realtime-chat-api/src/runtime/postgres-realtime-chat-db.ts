import { Pool } from "pg";
import { Kysely, PostgresDialect, sql } from "kysely";
import type {
  RealtimeChatDbPort,
  RealtimeChatMessageTarget,
  StoredGatewayTicket,
  StoredReadCursor,
  StoredRealtimeChatMessage,
} from "@wake-surfer/realtime-chat/api";

type RuntimeDatabase = Record<string, never>;

type MessageRow = {
  message_id: string;
  stream_id: string;
  stream_type: StoredRealtimeChatMessage["streamType"];
  sequence: number;
  sender_id: string | null;
  message_type: StoredRealtimeChatMessage["messageType"];
  content: unknown;
  created_at: Date | string;
  idempotency_key: string | null;
};

type ReadCursorRow = {
  actor_id: string;
  stream_id: string;
  last_read_sequence: number;
  updated_at: Date | string;
};

type GatewayTicketRow = {
  actor_id: string;
  workspace_id: string | null;
  consumed_at: Date | string | null;
  expires_at: Date | string;
};

export async function createPostgresRealtimeChatDb(
  connectionString: string,
): Promise<PostgresRealtimeChatDb> {
  const db = new Kysely<RuntimeDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
      }),
    }),
  });
  const adapter = new PostgresRealtimeChatDb(db);

  await adapter.ensureSchema();
  return adapter;
}

export class PostgresRealtimeChatDb implements RealtimeChatDbPort {
  constructor(private readonly db: Kysely<RuntimeDatabase>) {}

  async ensureSchema(): Promise<void> {
    await sql`
      create table if not exists realtime_chat_gateway_tickets (
        ticket_value_hash text primary key,
        actor_id text not null,
        workspace_id text,
        issued_at timestamptz not null,
        expires_at timestamptz not null,
        consumed_at timestamptz
      )
    `.execute(this.db);
    await sql`
      alter table realtime_chat_gateway_tickets
      add column if not exists consumed_at timestamptz
    `.execute(this.db);
    await sql`
      create table if not exists realtime_chat_stream_sequences (
        stream_id text primary key,
        next_sequence integer not null
      )
    `.execute(this.db);
    await sql`
      create table if not exists realtime_chat_messages (
        message_id text primary key,
        stream_id text not null,
        stream_type text not null,
        sequence integer not null,
        sender_id text,
        message_type text not null,
        content jsonb not null,
        created_at timestamptz not null,
        idempotency_key text,
        unique (stream_id, sequence)
      )
    `.execute(this.db);
    await sql`
      create unique index if not exists realtime_chat_messages_idempotency_key_idx
      on realtime_chat_messages (idempotency_key)
      where idempotency_key is not null
    `.execute(this.db);
    await sql`
      create table if not exists realtime_chat_read_cursors (
        actor_id text not null,
        stream_id text not null,
        last_read_sequence integer not null,
        updated_at timestamptz not null,
        primary key (actor_id, stream_id)
      )
    `.execute(this.db);
  }

  async issueGatewayTicket(ticket: StoredGatewayTicket): Promise<void> {
    await sql`
      insert into realtime_chat_gateway_tickets (
        ticket_value_hash,
        actor_id,
        workspace_id,
        issued_at,
        expires_at
      )
      values (
        ${ticket.ticketValueHash},
        ${ticket.actorId},
        ${ticket.workspaceId ?? null},
        ${ticket.issuedAt},
        ${ticket.expiresAt}
      )
    `.execute(this.db);
  }

  async consumeGatewayTicket(
    input: Parameters<RealtimeChatDbPort["consumeGatewayTicket"]>[0],
  ): Promise<Awaited<ReturnType<RealtimeChatDbPort["consumeGatewayTicket"]>>> {
    const consumed = await sql<GatewayTicketRow>`
      update realtime_chat_gateway_tickets
      set consumed_at = ${input.consumedAt}
      where ticket_value_hash = ${input.ticketValueHash}
        and expires_at > ${input.consumedAt}
        and consumed_at is null
      returning actor_id, workspace_id, consumed_at, expires_at
    `.execute(this.db);
    const consumedRow = consumed.rows[0];

    if (consumedRow) {
      const consumedAt = toIsoDateTime(consumedRow.consumed_at ?? input.consumedAt);

      return {
        status: "consumed",
        ticket: {
          actorId: consumedRow.actor_id,
          ...(consumedRow.workspace_id ? { workspaceId: consumedRow.workspace_id } : {}),
          consumedAt,
        },
      };
    }

    const existing = await sql<GatewayTicketRow>`
      select actor_id, workspace_id, consumed_at, expires_at
      from realtime_chat_gateway_tickets
      where ticket_value_hash = ${input.ticketValueHash}
      limit 1
    `.execute(this.db);
    const existingRow = existing.rows[0];

    if (existingRow?.consumed_at) {
      return {
        status: "rejected",
        reason: "GATEWAY_TICKET_ALREADY_CONSUMED",
      };
    }

    return {
      status: "rejected",
      reason: "GATEWAY_TICKET_INVALID_OR_EXPIRED",
    };
  }

  async findMessageByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredRealtimeChatMessage | undefined> {
    const result = await sql<MessageRow>`
      select *
      from realtime_chat_messages
      where idempotency_key = ${idempotencyKey}
      limit 1
    `.execute(this.db);
    const row = result.rows[0];

    return row ? toStoredMessage(row) : undefined;
  }

  async appendMessage(
    input: Parameters<RealtimeChatDbPort["appendMessage"]>[0],
  ): Promise<StoredRealtimeChatMessage> {
    return this.db.transaction().execute(async (trx) => {
      const streamId = streamIdForTarget(input.target);
      const sequenceResult = await sql<{ next_sequence: number }>`
        insert into realtime_chat_stream_sequences (stream_id, next_sequence)
        values (${streamId}, 1)
        on conflict (stream_id)
        do update set next_sequence = realtime_chat_stream_sequences.next_sequence + 1
        returning next_sequence
      `.execute(trx);
      const sequence = sequenceResult.rows[0]?.next_sequence;

      if (sequence === undefined) {
        throw new Error("failed to allocate realtime chat stream sequence");
      }

      const insertResult = await sql<MessageRow>`
        insert into realtime_chat_messages (
          message_id,
          stream_id,
          stream_type,
          sequence,
          sender_id,
          message_type,
          content,
          created_at,
          idempotency_key
        )
        values (
          ${input.messageId},
          ${streamId},
          ${input.streamType},
          ${sequence},
          ${input.senderId ?? null},
          ${input.messageType},
          cast(${JSON.stringify(input.content)} as jsonb),
          ${input.createdAt},
          ${input.idempotencyKey ?? null}
        )
        on conflict (idempotency_key)
        where idempotency_key is not null
        do nothing
        returning *
      `.execute(trx);
      const inserted = insertResult.rows[0];

      if (inserted) {
        return toStoredMessage(inserted);
      }

      if (input.idempotencyKey) {
        const existing = await sql<MessageRow>`
          select *
          from realtime_chat_messages
          where idempotency_key = ${input.idempotencyKey}
          limit 1
        `.execute(trx);
        const row = existing.rows[0];

        if (row) {
          return toStoredMessage(row);
        }
      }

      throw new Error("failed to append realtime chat message");
    });
  }

  async markReadCursor(
    input: Parameters<RealtimeChatDbPort["markReadCursor"]>[0],
  ): Promise<StoredReadCursor> {
    return this.db.transaction().execute(async (trx) => {
      const currentResult = await sql<ReadCursorRow>`
        select *
        from realtime_chat_read_cursors
        where actor_id = ${input.actorId}
          and stream_id = ${input.streamId}
        for update
      `.execute(trx);
      const current = currentResult.rows[0];

      if (current && current.last_read_sequence >= input.lastReadSequence) {
        return {
          actorId: current.actor_id,
          streamId: current.stream_id,
          lastReadSequence: current.last_read_sequence,
          updatedAt: toIsoDateTime(current.updated_at),
          advanced: false,
        };
      }

      const upsertResult = await sql<ReadCursorRow>`
        insert into realtime_chat_read_cursors (
          actor_id,
          stream_id,
          last_read_sequence,
          updated_at
        )
        values (
          ${input.actorId},
          ${input.streamId},
          ${input.lastReadSequence},
          ${input.updatedAt}
        )
        on conflict (actor_id, stream_id)
        do update set
          last_read_sequence = excluded.last_read_sequence,
          updated_at = excluded.updated_at
        returning *
      `.execute(trx);
      const row = upsertResult.rows[0];

      if (!row) {
        throw new Error("failed to mark realtime chat read cursor");
      }

      return {
        actorId: row.actor_id,
        streamId: row.stream_id,
        lastReadSequence: row.last_read_sequence,
        updatedAt: toIsoDateTime(row.updated_at),
        advanced: true,
      };
    });
  }

  async listMessages(
    input: Parameters<RealtimeChatDbPort["listMessages"]>[0],
  ): Promise<Awaited<ReturnType<RealtimeChatDbPort["listMessages"]>>> {
    const result = await sql<MessageRow>`
      select *
      from realtime_chat_messages
      where stream_id = ${input.streamId}
        and (${input.afterSequence ?? null}::integer is null or sequence > ${input.afterSequence ?? null})
        and (${input.beforeSequence ?? null}::integer is null or sequence < ${input.beforeSequence ?? null})
      order by sequence asc
      limit ${input.limit + 1}
    `.execute(this.db);
    const rows = result.rows.slice(0, input.limit);
    const first = rows[0];
    const hasMoreBefore = first
      ? await this.hasMessageBefore(input.streamId, first.sequence)
      : false;

    return {
      messages: rows.map(toStoredMessage),
      hasMoreBefore,
      hasMoreAfter: result.rows.length > input.limit,
    };
  }

  async destroy(): Promise<void> {
    await this.db.destroy();
  }

  private async hasMessageBefore(streamId: string, sequence: number): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      select exists (
        select 1
        from realtime_chat_messages
        where stream_id = ${streamId}
          and sequence < ${sequence}
      ) as "exists"
    `.execute(this.db);

    return result.rows[0]?.exists ?? false;
  }
}

function toStoredMessage(row: MessageRow): StoredRealtimeChatMessage {
  return {
    messageId: row.message_id,
    streamId: row.stream_id,
    streamType: row.stream_type,
    sequence: row.sequence,
    ...(row.sender_id ? { senderId: row.sender_id } : {}),
    messageType: row.message_type,
    content: row.content as StoredRealtimeChatMessage["content"],
    createdAt: toIsoDateTime(row.created_at),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
  };
}

function streamIdForTarget(target: RealtimeChatMessageTarget): string {
  if (target.kind === "channel") {
    return `channel:${target.workspaceId}:${target.channelId}`;
  }

  if (target.kind === "dm") {
    return `dm:${target.dmConversationId}`;
  }

  return `thread:${target.threadId}`;
}

function toIsoDateTime(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
