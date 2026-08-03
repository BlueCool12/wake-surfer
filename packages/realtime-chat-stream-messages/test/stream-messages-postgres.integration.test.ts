import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "@wake-surfer/realtime-chat-database/integration-test";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createLoadLatestMessages,
  createLoadOlderMessages,
  createSyncAfterMessages,
  StreamMessagesDataIntegrityError,
  type ChannelReadAuthorizer,
} from "../src/index";

describe("Stream Messages PostgreSQL queries", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("returns an authorized empty channel without creating a stream row", async () => {
    const authorizeRead = vi.fn<ChannelReadAuthorizer>(() => ({ status: "allowed" }));
    const useCases = createUseCases(authorizeRead);

    const result = await useCases.loadLatest(
      { channelId: "empty-channel" },
      { actorId: "actor-empty-channel" },
    );

    expect(result).toEqual({
      status: "success",
      page: {
        throughSequence: 0,
        messages: [],
        nextBeforeSequence: null,
        hasMoreBefore: false,
      },
    });
    expect(authorizeRead).toHaveBeenCalledWith({
      actorId: "actor-empty-channel",
      channelId: "empty-channel",
    });
    await expect(
      getDatabase()
        .db.selectFrom("message_streams")
        .select("stream_id")
        .where("stream_id", "=", "channel:empty-channel")
        .execute(),
    ).resolves.toEqual([]);
  });

  it("loads latest and older pages in ascending order", async () => {
    const channelId = "history-channel";
    await insertMessages(channelId, 1, 120);
    const useCases = createUseCases(() => ({ status: "allowed" }));

    const latest = await useCases.loadLatest({ channelId }, { actorId: "actor-history" });
    expect(latest.status).toBe("success");

    if (latest.status !== "success") {
      throw new Error("latest 조회가 성공해야 합니다.");
    }

    const older = await useCases.loadOlder(
      {
        channelId,
        beforeSequence: latest.page.nextBeforeSequence!,
        limit: 50,
      },
      { actorId: "actor-history" },
    );

    expect(older.status).toBe("success");

    if (older.status !== "success") {
      throw new Error("older 조회가 성공해야 합니다.");
    }

    expect(latest.page.messages.map((message) => message.sequence)).toEqual([
      116, 117, 118, 119, 120,
    ]);
    expect(latest.page).toMatchObject({
      throughSequence: 120,
      nextBeforeSequence: 116,
      hasMoreBefore: true,
    });
    expect(latest.page.messages[0]).toMatchObject({
      messageId: "message-history-channel-116",
      senderActorId: "actor-message-author",
      content: {
        type: "text",
        text: "message 116",
      },
    });
    expect(latest.page.messages[0]).not.toHaveProperty("streamId");
    expect(older.page.messages.map((message) => message.sequence)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 66),
    );
    expect(older.page).toMatchObject({
      beforeSequence: 116,
      nextBeforeSequence: 66,
      hasMoreBefore: true,
    });
  });

  it("keeps the first sync watermark stable across concurrent append", async () => {
    const channelId = "sync-watermark-channel";
    await insertMessages(channelId, 1, 120);
    const useCases = createUseCases(() => ({ status: "allowed" }));

    const first = await useCases.syncAfter(
      {
        channelId,
        afterSequence: 117,
        limit: 2,
      },
      { actorId: "actor-sync" },
    );

    expect(first.status).toBe("success");

    if (first.status !== "success") {
      throw new Error("첫 sync-after 조회가 성공해야 합니다.");
    }

    await insertMessages(channelId, 121, 121);
    const second = await useCases.syncAfter(
      {
        channelId,
        afterSequence: first.page.nextAfterSequence,
        throughSequence: first.page.throughSequence,
        limit: 2,
      },
      { actorId: "actor-sync" },
    );

    expect(second.status).toBe("success");

    if (second.status !== "success") {
      throw new Error("두 번째 sync-after 조회가 성공해야 합니다.");
    }

    expect(first.page).toMatchObject({
      throughSequence: 120,
      nextAfterSequence: 119,
      hasMoreAfter: true,
    });
    expect(first.page.messages.map((message) => message.sequence)).toEqual([118, 119]);
    expect(second.page).toMatchObject({
      throughSequence: 120,
      nextAfterSequence: 120,
      hasMoreAfter: false,
    });
    expect(second.page.messages.map((message) => message.sequence)).toEqual([120]);
  });

  it("returns unauthorized and invalid-cursor failures as values", async () => {
    const deniedUseCases = createUseCases(() => ({ status: "denied" }));

    await expect(
      deniedUseCases.loadLatest({ channelId: "private-channel" }, { actorId: "actor-denied" }),
    ).resolves.toEqual({
      status: "failure",
      code: "stream_unavailable",
    });

    const allowedUseCases = createUseCases(() => ({ status: "allowed" }));
    await expect(
      allowedUseCases.syncAfter(
        {
          channelId: "missing-channel",
          afterSequence: 1,
          limit: 50,
        },
        { actorId: "actor-invalid-cursor" },
      ),
    ).resolves.toEqual({
      status: "failure",
      code: "invalid_cursor",
    });
  });

  it("detects sequence gaps without including message content in the error", async () => {
    const channelId = "gap-channel";
    const streamId = `channel:${channelId}`;
    const sensitiveContent = "gap-sensitive-content";
    await sql`
      INSERT INTO message_streams (stream_id, target_type, target_id, last_sequence, created_at)
      VALUES (${streamId}, ${"channel"}, ${channelId}, 2, now())
    `.execute(getDatabase().db);
    await insertMessageRow(channelId, 2, sensitiveContent);
    const useCases = createUseCases(() => ({ status: "allowed" }));

    const error = await useCases.loadLatest({ channelId }, { actorId: "actor-gap" }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(StreamMessagesDataIntegrityError);
    expect(error).toMatchObject({ reason: "sequence_gap" });
    expect((error as Error).message).not.toContain(sensitiveContent);
  });

  function createUseCases(authorizeRead: ChannelReadAuthorizer) {
    const dependencies = {
      db: getDatabase().db,
      authorizeRead,
    };

    return {
      loadLatest: createLoadLatestMessages(dependencies),
      loadOlder: createLoadOlderMessages(dependencies),
      syncAfter: createSyncAfterMessages(dependencies),
    };
  }

  function getDatabase(): RealtimeChatIntegrationTestDatabase {
    if (database === undefined) {
      throw new Error("Stream Messages 통합 테스트 database가 준비되지 않았습니다.");
    }

    return database;
  }

  async function insertMessages(
    channelId: string,
    firstSequence: number,
    lastSequence: number,
  ): Promise<void> {
    const streamId = `channel:${channelId}`;
    await sql`
      INSERT INTO message_streams (stream_id, target_type, target_id, last_sequence, created_at)
      VALUES (${streamId}, ${"channel"}, ${channelId}, ${lastSequence}, now())
      ON CONFLICT (stream_id) DO UPDATE SET last_sequence = EXCLUDED.last_sequence
    `.execute(getDatabase().db);

    for (let sequence = firstSequence; sequence <= lastSequence; sequence += 1) {
      await insertMessageRow(channelId, sequence, `message ${sequence}`);
    }
  }

  async function insertMessageRow(
    channelId: string,
    sequence: number,
    contentText: string,
  ): Promise<void> {
    const streamId = `channel:${channelId}`;
    await sql`
      INSERT INTO messages (
        message_id,
        stream_id,
        sequence,
        sender_actor_id,
        target_type,
        target_id,
        client_message_id,
        content_type,
        content_text,
        sent_at_client,
        created_at
      )
      VALUES (
        ${`message-${channelId}-${sequence}`},
        ${streamId},
        ${sequence},
        ${"actor-message-author"},
        ${"channel"},
        ${channelId},
        ${`client-${channelId}-${sequence}`},
        ${"text"},
        ${contentText},
        NULL,
        now()
      )
    `.execute(getDatabase().db);
  }
});
