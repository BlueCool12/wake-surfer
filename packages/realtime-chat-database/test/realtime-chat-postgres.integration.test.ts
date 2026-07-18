import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import {
  createGatewayTicketsTable,
  type GatewayTicketDatabase,
} from "@wake-surfer/realtime-chat-gateway-ticket/table-contract";
import { createMessageSendModule } from "@wake-surfer/realtime-chat-message-send";
import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "../src/realtime-chat-integration-test";
import {
  createRealtimeChatDatabase,
  type RealtimeChatDatabaseHandle,
} from "../src/realtime-chat-database";
import { runRealtimeChatMigrations } from "../src/realtime-chat-migrations";

const MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT = "messages_content_text_utf8_8kib_check";
const MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT = "messages_content_type_text_check";

describe("realtime-chat PostgreSQL integration harness", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("applies ordered migrations to a fresh schema and records their immutable metadata", async () => {
    const result = await sql<{
      version: string;
      name: string;
      checksum: string;
      applied_at: Date;
    }>`
      SELECT version, name, checksum, applied_at
      FROM realtime_chat_schema_migrations
      ORDER BY version ASC
    `.execute(getDatabase().db);

    expect(result.rows).toHaveLength(3);
    expect(result.rows).toMatchObject([
      {
        version: "001",
        name: "create_gateway_ticket_and_message_schema",
      },
      {
        version: "002",
        name: "add_messages_content_text_utf8_8kib_constraint",
      },
      {
        version: "003",
        name: "add_messages_content_type_text_constraint",
      },
    ]);
    for (const migration of result.rows) {
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(migration.applied_at).toBeInstanceOf(Date);
    }
  });

  it("enforces the named UTF-8 8KiB constraint for direct SQL inserts", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();
    const suffix = randomUUID();
    const streamId = `channel:direct-sql-${suffix}`;

    try {
      await temporaryDatabase.database.migrate();
      await createDirectMessageStream(temporaryDatabase.database.db, streamId);
      await insertDirectMessage(temporaryDatabase.database.db, {
        messageId: `message-8192-${suffix}`,
        streamId,
        sequence: 1,
        clientMessageId: `client-8192-${suffix}`,
        contentText: "a".repeat(8_192),
      });

      await expect(
        insertDirectMessage(temporaryDatabase.database.db, {
          messageId: `message-8193-${suffix}`,
          streamId,
          sequence: 2,
          clientMessageId: `client-8193-${suffix}`,
          contentText: "a".repeat(8_193),
        }),
      ).rejects.toThrow(MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT);

      const constraints = await getMessageConstraintsByName(
        temporaryDatabase.database.db,
        MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT,
      );

      expect(constraints).toHaveLength(1);
      expect(constraints[0]).toMatchObject({
        constraint_name: MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT,
        constraint_type: "c",
        is_validated: true,
      });
      expect(constraints[0]?.definition).toContain("octet_length(content_text) <= 8192");
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("enforces the named text content type constraint for direct SQL inserts", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();
    const suffix = randomUUID();
    const streamId = `channel:direct-content-type-${suffix}`;

    try {
      await temporaryDatabase.database.migrate();
      await createDirectMessageStream(temporaryDatabase.database.db, streamId);

      await expect(
        insertDirectMessage(temporaryDatabase.database.db, {
          messageId: `message-system-${suffix}`,
          streamId,
          sequence: 1,
          clientMessageId: `client-system-${suffix}`,
          contentType: "system",
          contentText: "must not be stored as a user message",
        }),
      ).rejects.toThrow(MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT);

      const constraints = await getMessageConstraintsByName(
        temporaryDatabase.database.db,
        MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT,
      );

      expect(constraints).toHaveLength(1);
      expect(constraints[0]).toMatchObject({
        constraint_name: MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT,
        constraint_type: "c",
        is_validated: true,
      });
      expect(constraints[0]?.definition).toContain("content_type = 'text'::text");
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("audits existing violating rows without exposing or changing content", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();
    const suffix = randomUUID();
    const streamId = `channel:existing-violation-${suffix}`;
    const messageId = `message-existing-violation-${suffix}`;
    const violatingContent = "a".repeat(8_193);

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createBaselineLegacyMessageSendTables(temporaryDatabase.database.db);
      await createDirectMessageStream(temporaryDatabase.database.db, streamId);
      await insertDirectMessage(temporaryDatabase.database.db, {
        messageId,
        streamId,
        sequence: 1,
        clientMessageId: `client-existing-violation-${suffix}`,
        contentText: violatingContent,
      });

      const migrationError = await temporaryDatabase.database.migrate().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(migrationError).toBeInstanceOf(Error);
      const errorMessage = (migrationError as Error).message;
      expect(errorMessage).toContain(messageId);
      expect(errorMessage).toContain(streamId);
      expect(errorMessage).toContain('"sequence":1');
      expect(errorMessage).toContain('"byteLength":8193');
      expect(errorMessage).not.toContain(violatingContent);

      const persisted = await sql<{ content_text: string }>`
        SELECT content_text
        FROM messages
        WHERE message_id = ${messageId}
      `.execute(temporaryDatabase.database.db);
      const migrationHistory = await sql<{ version: string }>`
        SELECT version
        FROM realtime_chat_schema_migrations
        ORDER BY version ASC
      `.execute(temporaryDatabase.database.db);

      expect(persisted.rows).toEqual([{ content_text: violatingContent }]);
      expect(migrationHistory.rows).toEqual([{ version: "001" }]);
      await expect(
        getMessageConstraintsByName(
          temporaryDatabase.database.db,
          MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT,
        ),
      ).resolves.toEqual([]);
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("audits existing non-text rows without exposing or changing message content", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();
    const suffix = randomUUID();
    const streamId = `channel:existing-content-type-violation-${suffix}`;
    const messageId = `message-existing-content-type-violation-${suffix}`;
    const sensitiveContent = `sensitive-message-${suffix}`;

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createBaselineLegacyMessageSendTables(temporaryDatabase.database.db);
      await createDirectMessageStream(temporaryDatabase.database.db, streamId);
      await insertDirectMessage(temporaryDatabase.database.db, {
        messageId,
        streamId,
        sequence: 1,
        clientMessageId: `client-existing-content-type-violation-${suffix}`,
        contentType: "system",
        contentText: sensitiveContent,
      });

      const migrationError = await temporaryDatabase.database.migrate().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(migrationError).toBeInstanceOf(Error);
      const errorMessage = (migrationError as Error).message;
      expect(errorMessage).toContain(messageId);
      expect(errorMessage).toContain(streamId);
      expect(errorMessage).toContain('"sequence":1');
      expect(errorMessage).toContain('"contentType":"system"');
      expect(errorMessage).not.toContain(sensitiveContent);

      const persisted = await sql<{ content_type: string; content_text: string }>`
        SELECT content_type, content_text
        FROM messages
        WHERE message_id = ${messageId}
      `.execute(temporaryDatabase.database.db);
      const migrationHistory = await sql<{ version: string }>`
        SELECT version
        FROM realtime_chat_schema_migrations
        ORDER BY version ASC
      `.execute(temporaryDatabase.database.db);

      expect(persisted.rows).toEqual([{ content_type: "system", content_text: sensitiveContent }]);
      expect(migrationHistory.rows).toEqual([{ version: "001" }, { version: "002" }]);
      await expect(
        getMessageConstraintsByName(
          temporaryDatabase.database.db,
          MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT,
        ),
      ).resolves.toEqual([]);
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("does not duplicate named message constraints when migrate repeats", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await temporaryDatabase.database.migrate();
      await temporaryDatabase.database.migrate();

      const migrationHistory = await sql<{ version: string }>`
        SELECT version
        FROM realtime_chat_schema_migrations
        ORDER BY version ASC
      `.execute(temporaryDatabase.database.db);

      expect(migrationHistory.rows).toEqual([
        { version: "001" },
        { version: "002" },
        { version: "003" },
      ]);
      await expect(
        getMessageConstraintsByName(
          temporaryDatabase.database.db,
          MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT,
        ),
      ).resolves.toHaveLength(1);
      await expect(
        getMessageConstraintsByName(
          temporaryDatabase.database.db,
          MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT,
        ),
      ).resolves.toHaveLength(1);
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("boots gateway ticket tables and consumes an issued ticket", async () => {
    const gatewayTicket = createGatewayTicketModule({
      db: getDatabase().db,
      assignGateway: createStaticGatewayAssigner({
        gatewayId: "gateway-integration-test",
        gatewayUrl: "wss://gateway.example.test/realtime-chat",
      }),
      ticketTtlMilliseconds: 60_000,
      rawTicketBytes: 16,
    });

    const issued = await gatewayTicket.issue({
      actorId: "actor-integration-test",
    });
    const consumed = await gatewayTicket.consume(
      {
        ticket: issued.ticket,
      },
      {
        gatewayId: "gateway-integration-test",
      },
    );

    expect(consumed).toMatchObject({
      status: "consumed",
      ticket: {
        actorId: "actor-integration-test",
      },
    });
  });

  it("boots message tables and persists a channel message", async () => {
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
    });

    const result = await messageSend.send(
      {
        clientMessageId: "client-message-integration-test",
        target: {
          type: "channel",
          channelId: "channel-integration-test",
        },
        content: {
          type: "text",
          text: "PostgreSQL integration smoke test",
        },
      },
      {
        actorId: "actor-integration-test",
      },
    );

    expect(result).toMatchObject({
      status: "accepted",
      message: {
        sequence: 1,
        streamId: "channel:channel-integration-test",
      },
    });

    const persisted = await getDatabase()
      .db.selectFrom("messages")
      .select(["stream_id", "sequence", "content_text"])
      .executeTakeFirstOrThrow();

    expect(persisted).toEqual({
      stream_id: "channel:channel-integration-test",
      sequence: 1,
      content_text: "PostgreSQL integration smoke test",
    });
  });

  it("stores text at the UTF-8 8KiB limit and rejects an oversized command", async () => {
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
    });
    const textAtLimit = "a".repeat(8_192);

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-byte-limit",
          target: {
            type: "channel",
            channelId: "channel-byte-limit",
          },
          content: {
            type: "text",
            text: textAtLimit,
          },
        },
        {
          actorId: "actor-byte-limit",
        },
      ),
    ).resolves.toMatchObject({
      status: "accepted",
      message: {
        sequence: 1,
        content: {
          type: "text",
          text: textAtLimit,
        },
      },
    });

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-byte-limit-oversized",
          target: {
            type: "channel",
            channelId: "channel-byte-limit",
          },
          content: {
            type: "text",
            text: "a".repeat(8_193),
          },
        },
        {
          actorId: "actor-byte-limit",
        },
      ),
    ).resolves.toEqual({
      status: "rejected",
      clientMessageId: "client-message-byte-limit-oversized",
      reason: "invalid_content",
    });

    const persisted = await getDatabase()
      .db.selectFrom("messages")
      .select(["sequence", "content_text"])
      .where("stream_id", "=", "channel:channel-byte-limit")
      .execute();

    expect(persisted).toEqual([
      {
        sequence: 1,
        content_text: textAtLimit,
      },
    ]);
  });

  it("rolls back target-mismatched appends", async () => {
    const streamId = "channel:channel-target-mismatch-original";
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
      resolveTarget: () => ({
        status: "resolved",
        streamId,
        recipientActorIds: [],
      }),
    });

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-target-mismatch-original",
          target: {
            type: "channel",
            channelId: "channel-target-mismatch-original",
          },
          content: {
            type: "text",
            text: "original target",
          },
        },
        {
          actorId: "actor-target-mismatch",
        },
      ),
    ).resolves.toMatchObject({
      status: "accepted",
    });

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-target-mismatch-rejected",
          target: {
            type: "channel",
            channelId: "channel-target-mismatch-rejected",
          },
          content: {
            type: "text",
            text: "mismatched target",
          },
        },
        {
          actorId: "actor-target-mismatch",
        },
      ),
    ).rejects.toThrow("기존 메시지 stream의 target이 command target과 일치하지 않습니다.");

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-target-mismatch-original",
          target: {
            type: "channel",
            channelId: "channel-target-mismatch-rejected",
          },
          content: {
            type: "text",
            text: "mismatched idempotent retry",
          },
        },
        {
          actorId: "actor-target-mismatch",
        },
      ),
    ).rejects.toThrow("기존 메시지 stream의 target이 command target과 일치하지 않습니다.");

    const stream = await getDatabase()
      .db.selectFrom("message_streams")
      .select(["target_type", "target_id", "last_sequence"])
      .where("stream_id", "=", streamId)
      .executeTakeFirstOrThrow();
    const messages = await getDatabase()
      .db.selectFrom("messages")
      .select(["sequence", "target_type", "target_id"])
      .where("stream_id", "=", streamId)
      .execute();

    expect(stream).toEqual({
      target_type: "channel",
      target_id: "channel-target-mismatch-original",
      last_sequence: 1,
    });
    expect(messages).toEqual([
      {
        sequence: 1,
        target_type: "channel",
        target_id: "channel-target-mismatch-original",
      },
    ]);
  });

  it("keeps invariants for concurrent appends", async () => {
    const concurrentMessageCount = 12;
    const channelId = "channel-concurrent-append";
    const streamId = `channel:${channelId}`;
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
    });

    const results = await Promise.all(
      Array.from({ length: concurrentMessageCount }, (_, index) =>
        messageSend.send(
          {
            clientMessageId: `client-message-concurrent-${index}`,
            target: {
              type: "channel",
              channelId,
            },
            content: {
              type: "text",
              text: `concurrent message ${index}`,
            },
          },
          {
            actorId: "actor-concurrent-append",
          },
        ),
      ),
    );

    for (const result of results) {
      expect(result.status).toBe("accepted");
    }

    const stream = await getDatabase()
      .db.selectFrom("message_streams")
      .select(["target_type", "target_id", "last_sequence"])
      .where("stream_id", "=", streamId)
      .executeTakeFirstOrThrow();
    const messages = await getDatabase()
      .db.selectFrom("messages")
      .select(["sequence", "target_type", "target_id"])
      .where("stream_id", "=", streamId)
      .orderBy("sequence", "asc")
      .execute();

    expect(stream).toEqual({
      target_type: "channel",
      target_id: channelId,
      last_sequence: concurrentMessageCount,
    });
    expect(messages).toEqual(
      Array.from({ length: concurrentMessageCount }, (_, index) => ({
        sequence: index + 1,
        target_type: "channel",
        target_id: channelId,
      })),
    );
  });

  it("creates distinct schemas when setup runs concurrently", async () => {
    const results = await Promise.allSettled([
      createRealtimeChatIntegrationTestDatabase(),
      createRealtimeChatIntegrationTestDatabase(),
    ]);
    const databases = results
      .filter(
        (result): result is PromiseFulfilledResult<RealtimeChatIntegrationTestDatabase> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);

    try {
      const failure = results.find((result) => result.status === "rejected");

      if (failure?.status === "rejected") {
        throw failure.reason;
      }

      expect(new Set(databases.map((item) => item.schemaName)).size).toBe(databases.length);

      await expect(
        databases[0]!.db.selectFrom("gateway_tickets").select("ticket_hash").execute(),
      ).resolves.toEqual([]);
      await expect(
        databases[1]!.db.selectFrom("messages").select("message_id").execute(),
      ).resolves.toEqual([]);
    } finally {
      await Promise.all(databases.map((item) => item.close()));
    }
  });

  it("baselines the supported legacy schema before applying later migrations", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createBaselineLegacyMessageSendTables(temporaryDatabase.database.db);
      await sql`
        ALTER TABLE messages
        ADD CHECK (content_type = 'text')
      `.execute(temporaryDatabase.database.db);

      await temporaryDatabase.database.migrate();

      const result = await sql<{
        version: string;
        name: string;
        checksum: string;
        applied_at: Date;
      }>`
        SELECT version, name, checksum, applied_at
        FROM realtime_chat_schema_migrations
        ORDER BY version ASC
      `.execute(temporaryDatabase.database.db);

      expect(result.rows).toMatchObject([
        {
          version: "001",
          name: "create_gateway_ticket_and_message_schema",
        },
        {
          version: "002",
          name: "add_messages_content_text_utf8_8kib_constraint",
        },
        {
          version: "003",
          name: "add_messages_content_type_text_constraint",
        },
      ]);
      for (const migration of result.rows) {
        expect(migration.applied_at).toBeInstanceOf(Date);
      }
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("baselines only the explicit legacy version before applying later ordered migrations", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createBaselineLegacyMessageSendTables(temporaryDatabase.database.db);

      await runRealtimeChatMigrations(temporaryDatabase.database.db, {
        migrations: [
          {
            version: "001",
            name: "legacy_schema_baseline",
            checksum: "1".repeat(64),
            transaction: "required",
            execute: async () => {
              throw new Error("명시적 legacy baseline migration은 다시 실행하면 안 됩니다.");
            },
          },
          {
            version: "002",
            name: "create_followup_migration_probe",
            checksum: "2".repeat(64),
            transaction: "required",
            execute: async (db) => {
              await sql
                .raw(
                  `
                  CREATE TABLE migration_002_probe (
                    applied boolean NOT NULL
                  );
                `,
                )
                .execute(db);
            },
          },
        ],
      });

      const history = await sql<{ version: string }>`
        SELECT version
        FROM realtime_chat_schema_migrations
        ORDER BY version ASC
      `.execute(temporaryDatabase.database.db);
      const probe = await sql<{ relation: string | null }>`
        SELECT to_regclass('migration_002_probe')::text AS relation
      `.execute(temporaryDatabase.database.db);

      expect(history.rows).toEqual([{ version: "001" }, { version: "002" }]);
      expect(probe.rows[0]?.relation).toBe("migration_002_probe");
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("refuses to baseline a partial legacy schema", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await sql
        .raw(
          `
        CREATE TABLE gateway_tickets (
          ticket_hash text PRIMARY KEY
        );
      `,
        )
        .execute(temporaryDatabase.database.db);

      await expect(temporaryDatabase.database.migrate()).rejects.toThrow(
        "기존 realtime-chat schema를 baseline으로 기록할 수 없습니다",
      );

      const result = await sql<{ count: string }>`
        SELECT count(*)::text AS count
        FROM realtime_chat_schema_migrations
      `.execute(temporaryDatabase.database.db);

      expect(result.rows[0]?.count).toBe("0");
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("refuses to baseline a complete legacy schema with an unexpected check constraint", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createBaselineLegacyMessageSendTables(temporaryDatabase.database.db);
      await sql`
        ALTER TABLE messages
        ADD CONSTRAINT messages_reject_all_check CHECK (false)
      `.execute(temporaryDatabase.database.db);

      await expect(temporaryDatabase.database.migrate()).rejects.toThrow(
        "constraint 정의가 현재 schema와 다릅니다",
      );

      const result = await sql<{ count: string }>`
        SELECT count(*)::text AS count
        FROM realtime_chat_schema_migrations
      `.execute(temporaryDatabase.database.db);

      expect(result.rows[0]?.count).toBe("0");
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("refuses to baseline a legacy schema with different foreign key semantics", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createBaselineLegacyMessageSendTables(temporaryDatabase.database.db);
      await sql
        .raw(
          `
          ALTER TABLE messages DROP CONSTRAINT messages_stream_id_fkey;
          ALTER TABLE messages
            ADD CONSTRAINT messages_stream_id_fkey
            FOREIGN KEY (stream_id) REFERENCES message_streams(stream_id) ON DELETE CASCADE;
        `,
        )
        .execute(temporaryDatabase.database.db);

      await expect(temporaryDatabase.database.migrate()).rejects.toThrow(
        "constraint 정의가 현재 schema와 다릅니다",
      );

      const result = await sql<{ count: string }>`
        SELECT count(*)::text AS count
        FROM realtime_chat_schema_migrations
      `.execute(temporaryDatabase.database.db);

      expect(result.rows[0]?.count).toBe("0");
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("refuses to baseline a legacy schema with a partial secondary index", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createBaselineLegacyMessageSendTables(temporaryDatabase.database.db);
      await sql
        .raw("DROP INDEX messages_stream_sequence_idx")
        .execute(temporaryDatabase.database.db);
      await sql
        .raw(
          `
          CREATE INDEX messages_stream_sequence_idx
            ON messages (stream_id, sequence)
            WHERE sequence > 100;
        `,
        )
        .execute(temporaryDatabase.database.db);

      await expect(temporaryDatabase.database.migrate()).rejects.toThrow(
        "secondary index 정의가 현재 schema와 다릅니다",
      );

      const result = await sql<{ count: string }>`
        SELECT count(*)::text AS count
        FROM realtime_chat_schema_migrations
      `.execute(temporaryDatabase.database.db);

      expect(result.rows[0]?.count).toBe("0");
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("does not record a failed transactional migration", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await sql
        .raw(
          `
        CREATE TABLE unrelated_table (
          expires_at timestamptz NOT NULL
        );

        CREATE INDEX gateway_tickets_expires_at_idx
          ON unrelated_table (expires_at);
      `,
        )
        .execute(temporaryDatabase.database.db);

      await expect(temporaryDatabase.database.migrate()).rejects.toThrow(
        "gateway_tickets_expires_at_idx",
      );

      const result = await sql<{ count: string; gateway_tickets: string | null }>`
        SELECT count(*)::text AS count, to_regclass('gateway_tickets')::text AS gateway_tickets
        FROM realtime_chat_schema_migrations
      `.execute(temporaryDatabase.database.db);

      expect(result.rows[0]).toEqual({
        count: "0",
        gateway_tickets: null,
      });
    } finally {
      await temporaryDatabase.close();
    }
  });

  it("serializes concurrent migrate calls for one schema", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();
    const concurrentDatabase = createRealtimeChatDatabase({
      databaseUrl: temporaryDatabase.databaseUrl,
    });

    try {
      await Promise.all([temporaryDatabase.database.migrate(), concurrentDatabase.migrate()]);

      const result = await sql<{ version: string }>`
        SELECT version
        FROM realtime_chat_schema_migrations
        ORDER BY version ASC
      `.execute(temporaryDatabase.database.db);

      expect(result.rows).toEqual([{ version: "001" }, { version: "002" }, { version: "003" }]);
      await expect(
        temporaryDatabase.database.db.selectFrom("messages").select("message_id").execute(),
      ).resolves.toEqual([]);
    } finally {
      await concurrentDatabase.close();
      await temporaryDatabase.close();
    }
  });

  it("fails startup when an applied migration checksum has changed", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await temporaryDatabase.database.migrate();
      await sql`
        UPDATE realtime_chat_schema_migrations
        SET checksum = ${"tampered-checksum"}
        WHERE version = ${"001"}
      `.execute(temporaryDatabase.database.db);

      await expect(temporaryDatabase.database.migrate()).rejects.toThrow(
        "realtime-chat schema migration 무결성 검증에 실패했습니다: 001",
      );
    } finally {
      await temporaryDatabase.close();
    }
  });

  function getDatabase(): RealtimeChatIntegrationTestDatabase {
    if (database === undefined) {
      throw new Error("PostgreSQL 통합 테스트 database를 초기화하지 못했습니다.");
    }

    return database;
  }
});

type TemporarySchemaDatabase = {
  database: RealtimeChatDatabaseHandle;
  databaseUrl: string;
  close: () => Promise<void>;
};

async function createTemporarySchemaDatabase(): Promise<TemporarySchemaDatabase> {
  const databaseUrl = getTestDatabaseUrl();
  const schemaName = `realtime_chat_migration_it_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
  });
  let database: RealtimeChatDatabaseHandle | undefined;
  let schemaCreated = false;

  try {
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    schemaCreated = true;

    const schemaScopedDatabaseUrl = createSchemaScopedDatabaseUrl(databaseUrl, schemaName);
    database = createRealtimeChatDatabase({
      databaseUrl: schemaScopedDatabaseUrl,
    });

    return {
      database,
      databaseUrl: schemaScopedDatabaseUrl,
      close: async () => {
        await database.close();
        await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
        await adminPool.end();
      },
    };
  } catch (error) {
    try {
      await database?.close();
      if (schemaCreated) {
        await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      }
    } finally {
      await adminPool.end();
    }

    throw error;
  }
}

async function createBaselineLegacyMessageSendTables(
  db: RealtimeChatDatabaseHandle["db"],
): Promise<void> {
  await sql
    .raw(
      `
      CREATE TABLE message_streams (
        stream_id text PRIMARY KEY,
        target_type text NOT NULL,
        target_id text NOT NULL,
        last_sequence integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL
      );

      CREATE UNIQUE INDEX message_streams_target_idx
        ON message_streams (target_type, target_id);

      CREATE TABLE messages (
        message_id text PRIMARY KEY,
        stream_id text NOT NULL REFERENCES message_streams(stream_id),
        sequence integer NOT NULL,
        sender_actor_id text NOT NULL,
        target_type text NOT NULL,
        target_id text NOT NULL,
        client_message_id text NOT NULL,
        content_type text NOT NULL,
        content_text text NOT NULL,
        sent_at_client timestamptz NULL,
        created_at timestamptz NOT NULL,
        UNIQUE (stream_id, sequence),
        UNIQUE (sender_actor_id, stream_id, client_message_id)
      );

      CREATE INDEX messages_stream_sequence_idx
        ON messages (stream_id, sequence);
    `,
    )
    .execute(db);
}

async function createDirectMessageStream(
  db: RealtimeChatDatabaseHandle["db"],
  streamId: string,
): Promise<void> {
  await sql`
    INSERT INTO message_streams (
      stream_id,
      target_type,
      target_id,
      last_sequence,
      created_at
    )
    VALUES (${streamId}, ${"channel"}, ${streamId.slice("channel:".length)}, 0, now())
  `.execute(db);
}

async function insertDirectMessage(
  db: RealtimeChatDatabaseHandle["db"],
  input: {
    messageId: string;
    streamId: string;
    sequence: number;
    clientMessageId: string;
    contentType?: string;
    contentText: string;
  },
): Promise<void> {
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
      ${input.messageId},
      ${input.streamId},
      ${input.sequence},
      ${"actor-direct-sql"},
      ${"channel"},
      ${input.streamId.slice("channel:".length)},
      ${input.clientMessageId},
      ${input.contentType ?? "text"},
      ${input.contentText},
      NULL,
      now()
    )
  `.execute(db);
}

async function getMessageConstraintsByName(
  db: RealtimeChatDatabaseHandle["db"],
  constraintName: string,
): Promise<
  {
    constraint_name: string;
    constraint_type: string;
    is_validated: boolean;
    definition: string;
  }[]
> {
  const result = await sql<{
    constraint_name: string;
    constraint_type: string;
    is_validated: boolean;
    definition: string;
  }>`
    SELECT conname AS constraint_name,
      contype AS constraint_type,
      convalidated AS is_validated,
      pg_get_constraintdef(oid, true) AS definition
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'messages'::regclass
      AND conname = ${constraintName}
  `.execute(db);

  return result.rows;
}

function getTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("PostgreSQL 통합 테스트에는 TEST_DATABASE_URL 환경 변수가 필요합니다.");
  }

  return databaseUrl;
}

function createSchemaScopedDatabaseUrl(databaseUrl: string, schemaName: string): string {
  const parsed = new URL(databaseUrl);
  const existingOptions = parsed.searchParams.get("options");
  const searchPathOption = `-c search_path=${schemaName}`;

  parsed.searchParams.set(
    "options",
    existingOptions === null ? searchPathOption : `${existingOptions} ${searchPathOption}`,
  );

  return parsed.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
