import {
  getCanonicalStreamId,
  type MessageTarget,
} from "@wake-surfer/realtime-chat-message-contracts";
import {
  createPersistedTextMessageContent,
  parsePersistedTextMessageContent,
} from "@wake-surfer/realtime-chat-message-send/persisted-message-content";
import { sql, type Kysely } from "kysely";
import {
  parseMessageTarget,
  type DeletedMessage,
  type EditedTextMessage,
} from "../../message-mutation";
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
  editedAt: Date | null;
  deletedAt: Date | null;
};

export async function findEditMessageTarget(
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

export async function editOwnMessage(
  db: Kysely<MessageMutationDatabase>,
  input: {
    messageId: string;
    actorId: string;
    target: MessageTarget;
    text: string;
  },
): Promise<EditedTextMessage | DeletedMessage | undefined> {
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
        "messages.edited_at as editedAt",
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

    const updated = await trx
      .updateTable("messages")
      .set({
        content: createPersistedTextMessageContent(input.text),
        version: sql<number>`version + 1`,
        edited_at: sql<Date>`now()`,
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
        "edited_at as editedAt",
        "deleted_at as deletedAt",
      ])
      .executeTakeFirstOrThrow();

    return rowToEditedTextMessage({
      ...updated,
      targetType: current.targetType,
      targetId: current.targetId,
    });
  });
}

function rowToEditedTextMessage(row: CurrentMessageRow): EditedTextMessage {
  if (row.content === null || row.editedAt === null || row.deletedAt !== null) {
    throw new Error("메시지 수정 쿼리가 올바르지 않은 lifecycle 상태를 반환했습니다.");
  }

  const content = parsePersistedTextMessageContent(row.content);

  return {
    messageId: row.messageId,
    streamId: row.streamId,
    sequence: row.sequence,
    senderActorId: row.senderActorId,
    target: parseMessageTarget(row.targetType, row.targetId),
    version: row.version,
    text: content.text,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  };
}

function rowToDeletedMessage(row: CurrentMessageRow): DeletedMessage {
  if (row.content !== null || row.deletedAt === null) {
    throw new Error("메시지 수정 쿼리가 올바르지 않은 tombstone을 반환했습니다.");
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
