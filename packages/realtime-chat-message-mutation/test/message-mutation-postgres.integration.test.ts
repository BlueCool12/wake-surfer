import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "@wake-surfer/realtime-chat-database/integration-test";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createDeleteMessage,
  createEditMessage,
  type DeleteMessage,
  type EditMessage,
  type MessageMutationAuthorizer,
} from "../src";

describe("Message Mutation PostgreSQL transactions", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("edits an owned active message with a server version and database timestamp", async () => {
    const messageId = "message-edit-success";
    const channelId = "mutation-edit-success";
    await insertMessage({ messageId, channelId });
    const before = await databaseNow();
    const authorize = vi.fn<MessageMutationAuthorizer>(() => true);
    const { edit } = createUseCases(authorize);

    const result = await edit(
      { messageId, text: "  수정된 메시지  " },
      { actorId: "actor-author" },
    );
    const after = await databaseNow();

    expect(result.status).toBe("accepted");

    if (result.status !== "accepted") {
      throw new Error("메시지 수정이 성공해야 합니다.");
    }

    expect(result.message).toMatchObject({
      messageId,
      streamId: `channel:${channelId}`,
      sequence: 1,
      senderActorId: "actor-author",
      target: { type: "channel", channelId },
      version: 2,
      text: "수정된 메시지",
    });
    expect(result.message.editedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.message.editedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(authorize).toHaveBeenCalledWith({
      actorId: "actor-author",
      target: { type: "channel", channelId },
      capability: "message:edit_own",
    });

    await expect(readMessageState(messageId)).resolves.toMatchObject({
      version: 2,
      content: { schemaVersion: 1, kind: "text", text: "수정된 메시지" },
      editedAt: result.message.editedAt,
      deletedAt: null,
    });
  });

  it("checks current ownership inside the transaction", async () => {
    const messageId = "message-edit-not-owned";
    await insertMessage({ messageId, channelId: "mutation-edit-not-owned" });
    const { edit, deleteMessage } = createUseCases(() => true);

    await expect(
      edit({ messageId, text: "타인의 수정" }, { actorId: "actor-other" }),
    ).resolves.toEqual({
      status: "rejected",
      reason: "write_forbidden",
    });
    await expect(deleteMessage({ messageId }, { actorId: "actor-other" })).resolves.toEqual({
      status: "rejected",
      reason: "write_forbidden",
    });
    await expect(readMessageState(messageId)).resolves.toMatchObject({
      version: 1,
      content: { schemaVersion: 1, kind: "text", text: "원본 메시지" },
      editedAt: null,
      deletedAt: null,
    });
  });

  it("returns the same tombstone for repeated delete and rejects a later edit", async () => {
    const messageId = "message-delete-repeat";
    const channelId = "mutation-delete-repeat";
    await insertMessage({ messageId, channelId });
    const before = await databaseNow();
    const { edit, deleteMessage } = createUseCases(() => true);

    const first = await deleteMessage({ messageId }, { actorId: "actor-author" });
    const second = await deleteMessage({ messageId }, { actorId: "actor-author" });
    const after = await databaseNow();

    expect(first.status).toBe("accepted");
    expect(second).toEqual(first);

    if (first.status !== "accepted") {
      throw new Error("메시지 삭제가 성공해야 합니다.");
    }

    expect(first.message).toMatchObject({
      messageId,
      streamId: `channel:${channelId}`,
      sequence: 1,
      senderActorId: "actor-author",
      target: { type: "channel", channelId },
      version: 2,
    });
    expect(first.message).not.toHaveProperty("text");
    expect(first.message.deletedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(first.message.deletedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    await expect(
      edit({ messageId, text: "되살리기" }, { actorId: "actor-author" }),
    ).resolves.toEqual({
      status: "rejected",
      reason: "message_deleted",
      message: first.message,
    });
    await expect(readMessageState(messageId)).resolves.toMatchObject({
      version: 2,
      content: null,
      editedAt: null,
      deletedAt: first.message.deletedAt,
    });
  });

  it("serializes concurrent edits as last-write-wins with increasing versions", async () => {
    const messageId = "message-edit-race";
    await insertMessage({ messageId, channelId: "mutation-edit-race" });
    const { edit } = createUseCases(() => true);

    const results = await Promise.all([
      edit({ messageId, text: "수정 A" }, { actorId: "actor-author" }),
      edit({ messageId, text: "수정 B" }, { actorId: "actor-author" }),
    ]);

    expect(results.every((result) => result.status === "accepted")).toBe(true);

    const accepted = results.filter(
      (result): result is Extract<typeof result, { status: "accepted" }> =>
        result.status === "accepted",
    );
    const ordered = [...accepted].sort(
      (left, right) => left.message.version - right.message.version,
    );

    expect(ordered.map((result) => result.message.version)).toEqual([2, 3]);
    await expect(readMessageState(messageId)).resolves.toMatchObject({
      version: 3,
      content: {
        schemaVersion: 1,
        kind: "text",
        text: ordered[1]?.message.text,
      },
      deletedAt: null,
    });
  });

  it("converges concurrent edit and delete to a tombstone", async () => {
    const messageId = "message-edit-delete-race";
    await insertMessage({ messageId, channelId: "mutation-edit-delete-race" });
    const { edit, deleteMessage } = createUseCases(() => true);

    const [editResult, deleteResult] = await Promise.all([
      edit({ messageId, text: "경합 수정" }, { actorId: "actor-author" }),
      deleteMessage({ messageId }, { actorId: "actor-author" }),
    ]);

    expect(deleteResult.status).toBe("accepted");
    expect(
      editResult.status === "accepted" ||
        (editResult.status === "rejected" && editResult.reason === "message_deleted"),
    ).toBe(true);

    const state = await readMessageState(messageId);
    expect(state.content).toBeNull();
    expect(state.deletedAt).toBeInstanceOf(Date);
    expect(state.version).toBe(editResult.status === "accepted" ? 3 : 2);
  });

  it("increments the version once for concurrent deletes", async () => {
    const messageId = "message-delete-race";
    await insertMessage({ messageId, channelId: "mutation-delete-race" });
    const { deleteMessage } = createUseCases(() => true);

    const results = await Promise.all([
      deleteMessage({ messageId }, { actorId: "actor-author" }),
      deleteMessage({ messageId }, { actorId: "actor-author" }),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      status: "accepted",
      message: { version: 2 },
    });
    await expect(readMessageState(messageId)).resolves.toMatchObject({
      version: 2,
      content: null,
    });
  });

  function createUseCases(authorize: MessageMutationAuthorizer): {
    edit: EditMessage;
    deleteMessage: DeleteMessage;
  } {
    const dependencies = {
      db: getDatabase().db,
      authorize,
    };

    return {
      edit: createEditMessage(dependencies),
      deleteMessage: createDeleteMessage(dependencies),
    };
  }

  function getDatabase(): RealtimeChatIntegrationTestDatabase {
    if (database === undefined) {
      throw new Error("Message Mutation 통합 테스트 database가 준비되지 않았습니다.");
    }

    return database;
  }

  async function insertMessage(input: { messageId: string; channelId: string }): Promise<void> {
    const streamId = `channel:${input.channelId}`;

    await sql`
      INSERT INTO message_streams (target_type, target_id, last_sequence)
      VALUES (${"channel"}, ${input.channelId}, 1)
    `.execute(getDatabase().db);
    await sql`
      INSERT INTO messages (
        message_id,
        stream_id,
        sequence,
        sender_actor_id,
        content
      )
      VALUES (
        ${input.messageId},
        ${streamId},
        1,
        ${"actor-author"},
        ${JSON.stringify({ schemaVersion: 1, kind: "text", text: "원본 메시지" })}::jsonb
      )
    `.execute(getDatabase().db);
  }

  async function readMessageState(messageId: string): Promise<{
    version: number;
    content: unknown;
    editedAt: Date | null;
    deletedAt: Date | null;
  }> {
    return getDatabase()
      .db.selectFrom("messages")
      .select(["version", "content", "edited_at as editedAt", "deleted_at as deletedAt"])
      .where("message_id", "=", messageId)
      .executeTakeFirstOrThrow();
  }

  async function databaseNow(): Promise<Date> {
    const result = await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(
      getDatabase().db,
    );
    return result.rows[0]!.now;
  }
});
