import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "@wake-surfer/realtime-chat-database/integration-test";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createStreamMessagesModule,
  StreamMessagesDataIntegrityError,
  StreamMessagesDomainError,
  type ChannelReadAuthorizer,
} from "../src/index.js";

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
    const module = createModule(authorizeRead);

    const result = await module.loadLatest(
      { channelId: "empty-channel" },
      { actorId: "actor-empty-channel" },
    );

    expect(result).toEqual({
      streamId: "channel:empty-channel",
      throughSequence: 0,
      messages: [],
      nextBeforeSequence: null,
      hasMoreBefore: false,
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
    const module = createModule(() => ({ status: "allowed" }));

    const latest = await module.loadLatest({ channelId }, { actorId: "actor-history" });
    const older = await module.loadOlder(
      {
        channelId,
        beforeSequence: latest.nextBeforeSequence!,
        limit: 50,
      },
      { actorId: "actor-history" },
    );

    expect(latest.messages.map((message) => message.sequence)).toEqual([116, 117, 118, 119, 120]);
    expect(latest).toMatchObject({
      throughSequence: 120,
      nextBeforeSequence: 116,
      hasMoreBefore: true,
    });
    expect(older.messages.map((message) => message.sequence)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 66),
    );
    expect(older).toMatchObject({
      beforeSequence: 116,
      nextBeforeSequence: 66,
      hasMoreBefore: true,
    });
  });

  it("keeps the first sync watermark stable across concurrent append", async () => {
    const channelId = "sync-watermark-channel";
    await insertMessages(channelId, 1, 120);
    const module = createModule(() => ({ status: "allowed" }));

    const first = await module.syncAfter(
      {
        channelId,
        afterSequence: 117,
        limit: 2,
      },
      { actorId: "actor-sync" },
    );
    await insertMessages(channelId, 121, 121);
    const second = await module.syncAfter(
      {
        channelId,
        afterSequence: first.nextAfterSequence,
        throughSequence: first.throughSequence,
        limit: 2,
      },
      { actorId: "actor-sync" },
    );

    expect(first).toMatchObject({
      throughSequence: 120,
      nextAfterSequence: 119,
      hasMoreAfter: true,
    });
    expect(first.messages.map((message) => message.sequence)).toEqual([118, 119]);
    expect(second).toMatchObject({
      throughSequence: 120,
      nextAfterSequence: 120,
      hasMoreAfter: false,
    });
    expect(second.messages.map((message) => message.sequence)).toEqual([120]);
  });

  it("rejects unauthorized and invalid-cursor requests with distinct domain errors", async () => {
    const deniedModule = createModule(() => ({ status: "denied" }));

    await expect(
      deniedModule.loadLatest({ channelId: "private-channel" }, { actorId: "actor-denied" }),
    ).rejects.toMatchObject({
      code: "stream_unavailable",
    } satisfies Partial<StreamMessagesDomainError>);

    const allowedModule = createModule(() => ({ status: "allowed" }));
    await expect(
      allowedModule.syncAfter(
        {
          channelId: "missing-channel",
          afterSequence: 1,
          limit: 50,
        },
        { actorId: "actor-invalid-cursor" },
      ),
    ).rejects.toMatchObject({
      code: "invalid_cursor",
    } satisfies Partial<StreamMessagesDomainError>);
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
    const module = createModule(() => ({ status: "allowed" }));

    const error = await module.loadLatest({ channelId }, { actorId: "actor-gap" }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(StreamMessagesDataIntegrityError);
    expect(error).toMatchObject({ reason: "sequence_gap" });
    expect((error as Error).message).not.toContain(sensitiveContent);
  });

  function createModule(authorizeRead: ChannelReadAuthorizer) {
    return createStreamMessagesModule({
      db: getDatabase().db,
      authorizeRead,
    });
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
