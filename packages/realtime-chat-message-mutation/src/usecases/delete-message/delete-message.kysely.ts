import {
  getCanonicalStreamId,
  type MessageTarget,
} from "@wake-surfer/realtime-chat-message-contracts";
import { sql, type Kysely } from "kysely";
import { parseMessageTarget, type DeletedMessage } from "../../message-mutation";
import type { MessageMutationDatabase } from "../../message-mutation-table";

type CurrentMessageRow = {
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
  targetType: MessageTarget["type"];
  targetId: string;
  version: number;
  content: unknown;
  createdAt: Date;
  deletedAt: Date | null;
};

export async function findDeleteMessageTarget(
  db: Kysely<MessageMutationDatabase>,
  messageId: string,
): Promise<MessageTarget | undefined> {
  const row = await db
    .selectFrom("messages")
    .innerJoin("message_streams", "message_streams.stream_id", "messages.stream_id")
    .select(["message_streams.target_type as targetType", "message_streams.target_id as targetId"])
    .where("messages.message_id", "=", messageId)
    .executeTakeFirst();

  return row === undefined ? undefined : parseMessageTarget(row.targetType, row.targetId);
}

export async function deleteOwnMessage(
  db: Kysely<MessageMutationDatabase>,
  input: {
    messageId: string;
    actorId: string;
    target: MessageTarget;
  },
): Promise<DeletedMessage | undefined> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom("messages")
      .innerJoin("message_streams", "message_streams.stream_id", "messages.stream_id")
      .select([
        "messages.message_id as messageId",
        "messages.stream_id as streamId",
        "messages.sequence",
        "messages.sender_actor_id as senderActorId",
        "message_streams.target_type as targetType",
        "message_streams.target_id as targetId",
        "messages.version",
        "messages.content",
        "messages.created_at as createdAt",
        "messages.deleted_at as deletedAt",
      ])
      .where("messages.message_id", "=", input.messageId)
      .forUpdate("messages")
      .executeTakeFirst();

    if (
      current === undefined ||
      current.senderActorId !== input.actorId ||
      current.streamId !== getCanonicalStreamId(input.target)
    ) {
      return undefined;
    }

    if (current.deletedAt !== null) {
      return rowToDeletedMessage(current);
    }

    if (current.content === null) {
      throw new Error("활성 메시지의 content가 비어 있습니다.");
    }

    const deleted = await trx
      .updateTable("messages")
      .set({
        content: null,
        version: sql<number>`version + 1`,
        deleted_at: sql<Date>`now()`,
      })
      .where("message_id", "=", input.messageId)
      .where("sender_actor_id", "=", input.actorId)
      .where("deleted_at", "is", null)
      .returning([
        "message_id as messageId",
        "stream_id as streamId",
        "sequence",
        "sender_actor_id as senderActorId",
        "version",
        "content",
        "created_at as createdAt",
        "deleted_at as deletedAt",
      ])
      .executeTakeFirstOrThrow();

    return rowToDeletedMessage({
      ...deleted,
      targetType: current.targetType,
      targetId: current.targetId,
    });
  });
}

function rowToDeletedMessage(row: CurrentMessageRow): DeletedMessage {
  if (row.content !== null || row.deletedAt === null) {
    throw new Error("메시지 삭제 쿼리가 올바르지 않은 tombstone을 반환했습니다.");
  }

  return {
    messageId: row.messageId,
    streamId: row.streamId,
    sequence: row.sequence,
    senderActorId: row.senderActorId,
    target: parseMessageTarget(row.targetType, row.targetId),
    version: row.version,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}
