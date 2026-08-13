import type { MessageTarget } from "@wake-surfer/realtime-chat-message-send-contracts";
import { sql, type Kysely } from "kysely";
import {
  createPersistedTextMessageContent,
  parsePersistedTextMessageContent,
} from "../../persisted-message-content";
import {
  parseSendRequestFingerprint,
  type SendRequestFingerprint,
} from "../../send-request-fingerprint";
import { getSendMessageTargetId, getSendMessageTargetType } from "../../message-send";
import type { MessageSendDatabase } from "../../message-send-table";
import type { AppendedTextMessage, SenderScopedIdempotencyKey } from "../../send-message.types";

export type AppendTextMessageInput = SenderScopedIdempotencyKey & {
  messageId: string;
  streamId: string;
  target: MessageTarget;
  text: string;
  requestFingerprint: SendRequestFingerprint;
};

export type StoredSendMessageReceipt = Readonly<{
  requestFingerprint: SendRequestFingerprint;
  message: AppendedTextMessage | undefined;
}>;

export type AppendTextMessageResult =
  | {
      status: "created";
      receipt: StoredSendMessageReceipt;
    }
  | {
      status: "existing";
      receipt: StoredSendMessageReceipt;
    };

type AppendedTextMessageRow = {
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
  targetType: MessageTarget["type"];
  targetId: string;
  content: unknown;
  createdAt: Date;
  deletedAt: Date | null;
};

type StoredSendMessageReceiptRow = AppendedTextMessageRow & {
  canonicalizationVersion: number;
  fingerprintAlgorithm: string;
  fingerprintKeyId: string | null;
  requestFingerprint: Uint8Array;
};

export async function findSendMessageReceipt(
  db: Kysely<MessageSendDatabase>,
  key: SenderScopedIdempotencyKey,
): Promise<StoredSendMessageReceipt | undefined> {
  const row = await db
    .selectFrom("send_message_receipts")
    .innerJoin("messages", "messages.message_id", "send_message_receipts.result_message_id")
    .innerJoin("message_streams", "message_streams.stream_id", "messages.stream_id")
    .select([
      "send_message_receipts.canonicalization_version as canonicalizationVersion",
      "send_message_receipts.fingerprint_algorithm as fingerprintAlgorithm",
      "send_message_receipts.fingerprint_key_id as fingerprintKeyId",
      "send_message_receipts.request_fingerprint as requestFingerprint",
      "messages.message_id as messageId",
      "messages.stream_id as streamId",
      "messages.sequence",
      "messages.sender_actor_id as senderActorId",
      "message_streams.target_type as targetType",
      "message_streams.target_id as targetId",
      "messages.content",
      "messages.created_at as createdAt",
      "messages.deleted_at as deletedAt",
    ])
    .where("send_message_receipts.sender_actor_id", "=", key.senderActorId)
    .where("send_message_receipts.idempotency_key", "=", key.idempotencyKey)
    .executeTakeFirst();

  return row === undefined ? undefined : rowToStoredSendMessageReceipt(row);
}

export async function appendTextMessage(
  db: Kysely<MessageSendDatabase>,
  input: AppendTextMessageInput,
): Promise<AppendTextMessageResult> {
  return db.transaction().execute(async (trx) => {
    await acquireIdempotencyLock(trx, input);

    const existing = await findSendMessageReceipt(trx, input);

    if (existing !== undefined) {
      return {
        status: "existing",
        receipt: existing,
      };
    }

    const targetType = getSendMessageTargetType(input.target);
    const targetId = getSendMessageTargetId(input.target);

    await trx
      .insertInto("message_streams")
      .values({
        target_type: targetType,
        target_id: targetId,
      })
      .onConflict((oc) => oc.columns(["target_type", "target_id"]).doNothing())
      .executeTakeFirstOrThrow();

    const sequence = await advanceSequenceForTarget(trx, {
      streamId: input.streamId,
      targetType,
      targetId,
    });
    const inserted = await trx
      .insertInto("messages")
      .values({
        message_id: input.messageId,
        stream_id: input.streamId,
        sequence,
        sender_actor_id: input.senderActorId,
        content: createPersistedTextMessageContent(input.text),
      })
      .returning([
        "message_id as messageId",
        "stream_id as streamId",
        "sequence",
        "sender_actor_id as senderActorId",
        "content",
        "created_at as createdAt",
      ])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("send_message_receipts")
      .values({
        sender_actor_id: input.senderActorId,
        idempotency_key: input.idempotencyKey,
        canonicalization_version: input.requestFingerprint.canonicalizationVersion,
        fingerprint_algorithm: input.requestFingerprint.algorithm,
        fingerprint_key_id: input.requestFingerprint.keyId,
        request_fingerprint: input.requestFingerprint.value,
        result_message_id: input.messageId,
      })
      .executeTakeFirstOrThrow();

    return {
      status: "created",
      receipt: {
        requestFingerprint: input.requestFingerprint,
        message: rowToAppendedTextMessage({
          ...inserted,
          targetType,
          targetId,
          deletedAt: null,
        }),
      },
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

async function advanceSequenceForTarget(
  db: Kysely<MessageSendDatabase>,
  input: {
    streamId: string;
    targetType: MessageTarget["type"];
    targetId: string;
  },
): Promise<number> {
  const row = await db
    .updateTable("message_streams")
    .set({
      last_sequence: sql<number>`last_sequence + 1`,
    })
    .where("stream_id", "=", input.streamId)
    .where("target_type", "=", input.targetType)
    .where("target_id", "=", input.targetId)
    .returning("last_sequence as sequence")
    .executeTakeFirst();

  if (row === undefined) {
    throw new Error("기존 message stream의 target이 message target과 일치하지 않습니다.");
  }

  return row.sequence;
}

function rowToStoredSendMessageReceipt(row: StoredSendMessageReceiptRow): StoredSendMessageReceipt {
  return {
    requestFingerprint: parseSendRequestFingerprint({
      canonicalizationVersion: row.canonicalizationVersion,
      algorithm: row.fingerprintAlgorithm,
      keyId: row.fingerprintKeyId,
      value: row.requestFingerprint,
    }),
    message: rowToCurrentAppendedTextMessage(row),
  };
}

function rowToCurrentAppendedTextMessage(
  row: AppendedTextMessageRow,
): AppendedTextMessage | undefined {
  if (row.content === null && row.deletedAt !== null) {
    return undefined;
  }

  if (row.content === null || row.deletedAt !== null) {
    throw new Error("메시지 쿼리가 올바르지 않은 lifecycle 상태를 반환했습니다.");
  }

  return rowToAppendedTextMessage(row);
}

function rowToAppendedTextMessage(row: AppendedTextMessageRow): AppendedTextMessage {
  const target = parseTarget(row.targetType, row.targetId);
  const content = parsePersistedTextMessageContent(row.content);

  return {
    messageId: row.messageId,
    streamId: row.streamId,
    sequence: row.sequence,
    senderActorId: row.senderActorId,
    target,
    text: content.text,
    createdAt: row.createdAt,
  };
}

function parseTarget(targetType: MessageTarget["type"], targetId: string): MessageTarget {
  switch (targetType) {
    case "channel":
      return {
        type: "channel",
        channelId: targetId,
      };
    case "dm":
      return {
        type: "dm",
        dmConversationId: targetId,
      };
    case "thread":
      return {
        type: "thread",
        threadId: targetId,
      };
  }
}
