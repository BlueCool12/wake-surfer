import type { SendMessageTarget } from "@wake-surfer/realtime-chat-message-send-contracts";
import { sql, type Kysely } from "kysely";
import {
  getSendMessageTargetId,
  getSendMessageTargetType,
  normalizeMessageText,
} from "../../message-send";
import type { AppendedTextMessage, SenderScopedIdempotencyKey } from "../../message-send";
import type { MessageSendDatabase } from "../../message-send-table";

export type AppendTextMessageInput = SenderScopedIdempotencyKey & {
  messageId: string;
  streamId: string;
  target: SendMessageTarget;
  text: string;
  createdAt: Date;
};

export type AppendTextMessageResult =
  | {
      status: "created";
      message: AppendedTextMessage;
    }
  | {
      status: "existing";
      message: AppendedTextMessage;
    };

type MessageRow = {
  messageId?: unknown;
  streamId?: unknown;
  streamTargetType?: unknown;
  streamTargetId?: unknown;
  sequence?: unknown;
  senderActorId?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  text?: unknown;
  createdAt?: unknown;
};

export async function findAppendedTextMessageByIdempotencyKey(
  db: Kysely<MessageSendDatabase>,
  key: SenderScopedIdempotencyKey,
): Promise<AppendedTextMessage | undefined> {
  const row = await db
    .selectFrom("messages")
    .innerJoin("message_streams", "message_streams.stream_id", "messages.stream_id")
    .select([
      "messages.message_id as messageId",
      "messages.stream_id as streamId",
      "message_streams.target_type as streamTargetType",
      "message_streams.target_id as streamTargetId",
      "messages.sequence",
      "messages.sender_actor_id as senderActorId",
      "messages.target_type as targetType",
      "messages.target_id as targetId",
      "messages.content_text as text",
      "messages.created_at as createdAt",
    ])
    .where("messages.sender_actor_id", "=", key.senderActorId)
    .where("messages.idempotency_key", "=", key.idempotencyKey)
    .$castTo<MessageRow>()
    .executeTakeFirst();

  return row === undefined ? undefined : rowToAppendedTextMessage(row);
}

export async function appendTextMessage(
  db: Kysely<MessageSendDatabase>,
  input: AppendTextMessageInput,
): Promise<AppendTextMessageResult> {
  return db.transaction().execute(async (trx) => {
    await acquireIdempotencyLock(trx, input);

    const existing = await findAppendedTextMessageByIdempotencyKey(trx, input);

    if (existing !== undefined) {
      return {
        status: "existing",
        message: existing,
      };
    }

    const targetType = getSendMessageTargetType(input.target);
    const targetId = getSendMessageTargetId(input.target);

    await trx
      .insertInto("message_streams")
      .values({
        stream_id: input.streamId,
        target_type: targetType,
        target_id: targetId,
        last_sequence: 0,
        created_at: input.createdAt,
      })
      .onConflict((oc) => oc.column("stream_id").doNothing())
      .executeTakeFirstOrThrow();

    const stream = await trx
      .selectFrom("message_streams")
      .select(["target_type as targetType", "target_id as targetId"])
      .where("stream_id", "=", input.streamId)
      .forUpdate()
      .$castTo<{ targetType?: unknown; targetId?: unknown }>()
      .executeTakeFirstOrThrow();

    assertStreamTargetMatches(stream.targetType, stream.targetId, input.target);

    const sequenceRow = await trx
      .updateTable("message_streams")
      .set({
        last_sequence: sql<number>`last_sequence + 1`,
      })
      .where("stream_id", "=", input.streamId)
      .returning("last_sequence as sequence")
      .$castTo<{ sequence?: unknown }>()
      .executeTakeFirstOrThrow();

    const sequence = parseSequence(sequenceRow.sequence);

    const row = await trx
      .insertInto("messages")
      .values({
        message_id: input.messageId,
        stream_id: input.streamId,
        sequence,
        sender_actor_id: input.senderActorId,
        target_type: targetType,
        target_id: targetId,
        idempotency_key: input.idempotencyKey,
        content_text: input.text,
        created_at: input.createdAt,
      })
      .returning([
        "message_id as messageId",
        "stream_id as streamId",
        "sequence",
        "sender_actor_id as senderActorId",
        "target_type as targetType",
        "target_id as targetId",
        "content_text as text",
        "created_at as createdAt",
      ])
      .$castTo<MessageRow>()
      .executeTakeFirstOrThrow();

    return {
      status: "created",
      message: rowToAppendedTextMessage(row),
    };
  });
}

async function acquireIdempotencyLock(
  db: Kysely<MessageSendDatabase>,
  key: SenderScopedIdempotencyKey,
): Promise<void> {
  await sql`
    SELECT pg_advisory_xact_lock(
      hashtext(${key.senderActorId}),
      hashtext(${key.idempotencyKey})
    )
  `.execute(db);
}

function rowToAppendedTextMessage(row: MessageRow): AppendedTextMessage {
  const target = parseTarget(row.targetType, row.targetId);

  if (row.streamTargetType !== undefined || row.streamTargetId !== undefined) {
    assertStreamTargetMatches(row.streamTargetType, row.streamTargetId, target);
  }

  const text = parseString(row.text, "text");

  if (normalizeMessageText(text) !== text) {
    throw new Error("메시지 쿼리가 정규화되지 않은 text를 반환했습니다.");
  }

  return {
    messageId: parseString(row.messageId, "messageId"),
    streamId: parseString(row.streamId, "streamId"),
    sequence: parseSequence(row.sequence),
    senderActorId: parseString(row.senderActorId, "senderActorId"),
    target,
    text,
    createdAt: parseDate(row.createdAt, "createdAt"),
  };
}

function assertStreamTargetMatches(
  streamTargetType: unknown,
  streamTargetId: unknown,
  target: SendMessageTarget,
): void {
  if (
    streamTargetType !== getSendMessageTargetType(target) ||
    streamTargetId !== getSendMessageTargetId(target)
  ) {
    throw new Error("기존 message stream의 target이 message target과 일치하지 않습니다.");
  }
}

function parseTarget(targetType: unknown, targetId: unknown): SendMessageTarget {
  const parsedTargetId = parseString(targetId, "targetId");

  if (targetType === "channel") {
    return {
      type: "channel",
      channelId: parsedTargetId,
    };
  }

  if (targetType === "dm") {
    return {
      type: "dm",
      dmConversationId: parsedTargetId,
    };
  }

  if (targetType === "thread") {
    return {
      type: "thread",
      threadId: parsedTargetId,
    };
  }

  throw new Error("메시지 쿼리가 올바르지 않은 targetType을 반환했습니다.");
}

function parseSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("메시지 쿼리가 올바르지 않은 sequence를 반환했습니다.");
  }

  return value as number;
}

function parseString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`메시지 쿼리가 올바르지 않은 ${fieldName}를 반환했습니다.`);
  }

  return value;
}

function parseDate(value: unknown, fieldName: string): Date {
  const parsed = value instanceof Date ? value : new Date(parseString(value, fieldName));

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`메시지 쿼리가 올바르지 않은 ${fieldName}을 반환했습니다.`);
  }

  return parsed;
}
