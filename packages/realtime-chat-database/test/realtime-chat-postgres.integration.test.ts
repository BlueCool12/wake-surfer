import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import {
  createGatewayTicketsTable,
  type GatewayTicketDatabase,
} from "@wake-surfer/realtime-chat-gateway-ticket/table-contract";
import { createMessageSendModule } from "@wake-surfer/realtime-chat-message-send";
import {
  createMessageSendTables,
  type MessageSendDatabase,
} from "@wake-surfer/realtime-chat-message-send/table-contract";
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

describe("realtime-chat PostgreSQL integration harness", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("applies the ordered migration to a fresh schema and records its immutable metadata", async () => {
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

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      version: "001",
      name: "create_gateway_ticket_and_message_schema",
    });
    expect(result.rows[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rows[0]?.applied_at).toBeInstanceOf(Date);
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

  it("baselines a current legacy schema without rerunning its table creation", async () => {
    const temporaryDatabase = await createTemporarySchemaDatabase();

    try {
      await createGatewayTicketsTable(
        temporaryDatabase.database.db as unknown as Kysely<GatewayTicketDatabase>,
      );
      await createMessageSendTables(
        temporaryDatabase.database.db as unknown as Kysely<MessageSendDatabase>,
      );

      await temporaryDatabase.database.migrate();

      const result = await sql<{
        version: string;
        name: string;
        checksum: string;
        applied_at: Date;
      }>`
        SELECT version, name, checksum, applied_at
        FROM realtime_chat_schema_migrations
      `.execute(temporaryDatabase.database.db);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        version: "001",
        name: "create_gateway_ticket_and_message_schema",
      });
      expect(result.rows[0]?.applied_at).toBeInstanceOf(Date);
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
      await createMessageSendTables(
        temporaryDatabase.database.db as unknown as Kysely<MessageSendDatabase>,
      );

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
      await createMessageSendTables(
        temporaryDatabase.database.db as unknown as Kysely<MessageSendDatabase>,
      );
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
      await createMessageSendTables(
        temporaryDatabase.database.db as unknown as Kysely<MessageSendDatabase>,
      );
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
      await createMessageSendTables(
        temporaryDatabase.database.db as unknown as Kysely<MessageSendDatabase>,
      );
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

      expect(result.rows).toEqual([{ version: "001" }]);
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
