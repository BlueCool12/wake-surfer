import type {
  ActorId,
  ClientMessageId,
  MessageId,
  PublicMessage,
  SendMessageContent,
  SendMessageTarget,
  Sequence,
  StreamId,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import { sql, type Kysely } from "kysely";
import { getTargetId, getTargetType } from "../../message-send";
import type { MessageSendDatabase } from "../../message-send-table";

export type MessageAppendInput = {
  messageId: MessageId;
  streamId: StreamId;
  senderActorId: ActorId;
  target: SendMessageTarget;
  clientMessageId: ClientMessageId;
  content: SendMessageContent;
  sentAtClient?: string;
  createdAt: string;
};

export type MessageAppendResult =
  | {
      status: "created";
      message: PublicMessage;
    }
  | {
      status: "existing";
      message: PublicMessage;
    };

type MessageRow = {
  messageId?: unknown;
  streamId?: unknown;
  sequence?: unknown;
  senderActorId?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  contentType?: unknown;
  contentText?: unknown;
  sentAtClient?: unknown;
  createdAt?: unknown;
};

export async function findAcceptedMessageByClientMessageId(
  db: Kysely<MessageSendDatabase>,
  input: {
    senderActorId: ActorId;
    streamId: StreamId;
    clientMessageId: ClientMessageId;
  },
): Promise<PublicMessage | undefined> {
  const row = await db
    .selectFrom("messages")
    .select([
      "message_id as messageId",
      "stream_id as streamId",
      "sequence",
      "sender_actor_id as senderActorId",
      "target_type as targetType",
      "target_id as targetId",
      "content_type as contentType",
      "content_text as contentText",
      "sent_at_client as sentAtClient",
      "created_at as createdAt",
    ])
    .where("sender_actor_id", "=", input.senderActorId)
    .where("stream_id", "=", input.streamId)
    .where("client_message_id", "=", input.clientMessageId)
    .$castTo<MessageRow>()
    .executeTakeFirst();

  if (!row) {
    return undefined;
  }

  return parseMessageRow(row);
}

export async function appendMessage(
  db: Kysely<MessageSendDatabase>,
  input: MessageAppendInput,
): Promise<MessageAppendResult> {
  return db.transaction().execute(async (trx) => {
    const targetType = getTargetType(input.target);
    const targetId = getTargetId(input.target);

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

    await trx
      .selectFrom("message_streams")
      .select("stream_id")
      .where("stream_id", "=", input.streamId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    const existing = await findAcceptedMessageByClientMessageId(trx, {
      senderActorId: input.senderActorId,
      streamId: input.streamId,
      clientMessageId: input.clientMessageId,
    });

    if (existing) {
      return {
        status: "existing",
        message: existing,
      };
    }

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
        client_message_id: input.clientMessageId,
        content_type: input.content.type,
        content_text: input.content.text,
        sent_at_client: input.sentAtClient ?? null,
        created_at: input.createdAt,
      })
      .returning([
        "message_id as messageId",
        "stream_id as streamId",
        "sequence",
        "sender_actor_id as senderActorId",
        "target_type as targetType",
        "target_id as targetId",
        "content_type as contentType",
        "content_text as contentText",
        "sent_at_client as sentAtClient",
        "created_at as createdAt",
      ])
      .$castTo<MessageRow>()
      .executeTakeFirstOrThrow();

    return {
      status: "created",
      message: parseMessageRow(row),
    };
  });
}

function parseMessageRow(row: MessageRow): PublicMessage {
  return {
    messageId: parseString(row.messageId, "messageId"),
    streamId: parseString(row.streamId, "streamId"),
    sequence: parseSequence(row.sequence),
    senderActorId: parseString(row.senderActorId, "senderActorId"),
    target: parseTarget(row.targetType, row.targetId),
    content: parseContent(row.contentType, row.contentText),
    createdAt: parseIsoDateTime(row.createdAt, "createdAt"),
    ...(row.sentAtClient === null || row.sentAtClient === undefined
      ? {}
      : { sentAtClient: parseIsoDateTime(row.sentAtClient, "sentAtClient") }),
  };
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

function parseContent(contentType: unknown, contentText: unknown): SendMessageContent {
  if (contentType !== "text") {
    throw new Error("메시지 쿼리가 올바르지 않은 contentType을 반환했습니다.");
  }

  return {
    type: "text",
    text: parseString(contentText, "contentText"),
  };
}

function parseSequence(value: unknown): Sequence {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("메시지 쿼리가 올바르지 않은 sequence를 반환했습니다.");
  }

  return value;
}

function parseString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`메시지 쿼리가 올바르지 않은 ${fieldName}를 반환했습니다.`);
  }

  return value;
}

function parseIsoDateTime(value: unknown, fieldName: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`메시지 쿼리가 올바르지 않은 ${fieldName}을 반환했습니다.`);
}
