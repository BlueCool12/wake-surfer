import { createHash } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { RealtimeChatDatabase } from "./realtime-chat-database";

const MIGRATION_LOCK_KEY = 8_642_341_903_771_529n;
const MIGRATION_TABLE = "realtime_chat_schema_migrations";
const LEGACY_BASELINE_VERSION = "001";
const REALTIME_CHAT_TABLES = ["gateway_tickets", "message_streams", "messages"] as const;
const MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT = "messages_content_type_text_check";
const ADD_MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT_SQL = `
ALTER TABLE messages
ADD CONSTRAINT ${MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT}
CHECK (content_type = 'text') NOT VALID
`;
const VALIDATE_MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT_SQL = `
ALTER TABLE messages
VALIDATE CONSTRAINT ${MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT}
`;
const MESSAGE_CONTENT_TYPE_TEXT_MIGRATION_CHECKSUM_SOURCE = [
  ADD_MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT_SQL,
  VALIDATE_MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT_SQL,
].join("\n");
const MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT = "messages_content_text_utf8_8kib_check";
const MESSAGE_CONTENT_TEXT_UTF8_8KIB_AUDIT_SQL = `
SELECT message_id AS "messageId",
  stream_id AS "streamId",
  sequence,
  octet_length(content_text) AS "byteLength"
FROM messages
WHERE octet_length(content_text) > 8192
ORDER BY stream_id ASC, sequence ASC, message_id ASC
`;
const ADD_MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT_SQL = `
ALTER TABLE messages
ADD CONSTRAINT ${MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT}
CHECK (octet_length(content_text) <= 8192) NOT VALID
`;
const VALIDATE_MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT_SQL = `
ALTER TABLE messages
VALIDATE CONSTRAINT ${MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT}
`;
const MESSAGE_CONTENT_TEXT_UTF8_8KIB_MIGRATION_CHECKSUM_SOURCE = [
  "LOCK TABLE messages IN SHARE ROW EXCLUSIVE MODE",
  MESSAGE_CONTENT_TEXT_UTF8_8KIB_AUDIT_SQL,
  ADD_MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT_SQL,
  VALIDATE_MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT_SQL,
].join("\n");

type MigrationDatabase = Kysely<RealtimeChatDatabase>;

type RealtimeChatMigration = {
  version: string;
  name: string;
  checksum: string;
  transaction: "required" | "forbidden";
  execute: (db: MigrationDatabase) => Promise<void>;
};

type RealtimeChatMigrationRunnerOptions = {
  migrations?: readonly RealtimeChatMigration[];
  legacyBaselineVersion?: string;
};

type AppliedMigration = Pick<RealtimeChatMigration, "version" | "name" | "checksum">;

type MessageContentTextByteLengthViolation = {
  messageId: string;
  streamId: string;
  sequence: number;
  byteLength: number;
};

type LegacyColumn = {
  tableName: (typeof REALTIME_CHAT_TABLES)[number];
  columnName: string;
  dataType: string;
  nullable: boolean;
  defaultValue: "none" | "zero";
};

type LegacyConstraint = {
  tableName: (typeof REALTIME_CHAT_TABLES)[number];
  type: "c" | "f" | "p" | "u" | "x";
  definition: string;
};

type LegacyIndex = {
  tableName: (typeof REALTIME_CHAT_TABLES)[number];
  indexName: string;
  unique: boolean;
  accessMethod: string;
  keyDefinitions: readonly string[];
  includedDefinitions: readonly string[];
  predicate: string | null;
  nullsNotDistinct: boolean;
};

const INITIAL_SCHEMA_SQL = `
CREATE TABLE gateway_tickets (
  ticket_hash text PRIMARY KEY,
  actor_id text NOT NULL,
  assigned_gateway_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL
);

CREATE INDEX gateway_tickets_expires_at_idx
  ON gateway_tickets (expires_at);

CREATE INDEX gateway_tickets_assigned_gateway_id_idx
  ON gateway_tickets (assigned_gateway_id);

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
`;

const REALTIME_CHAT_MIGRATIONS: readonly RealtimeChatMigration[] = [
  {
    version: "001",
    name: "create_gateway_ticket_and_message_schema",
    checksum: createChecksum(INITIAL_SCHEMA_SQL),
    transaction: "required",
    execute: async (db) => {
      await sql.raw(INITIAL_SCHEMA_SQL).execute(db);
    },
  },
  {
    version: "002",
    name: "add_messages_content_text_utf8_8kib_constraint",
    checksum: createChecksum(MESSAGE_CONTENT_TEXT_UTF8_8KIB_MIGRATION_CHECKSUM_SOURCE),
    transaction: "required",
    execute: async (db) => {
      await addMessageContentTextUtf8ByteLengthConstraint(db);
    },
  },
  {
    version: "003",
    name: "add_messages_content_type_text_constraint",
    checksum: createChecksum(MESSAGE_CONTENT_TYPE_TEXT_MIGRATION_CHECKSUM_SOURCE),
    transaction: "required",
    execute: async (db) => {
      await addMessageContentTypeTextConstraint(db);
    },
  },
];

const LEGACY_COLUMNS: readonly LegacyColumn[] = [
  {
    tableName: "gateway_tickets",
    columnName: "ticket_hash",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "gateway_tickets",
    columnName: "actor_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "gateway_tickets",
    columnName: "assigned_gateway_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "gateway_tickets",
    columnName: "issued_at",
    dataType: "timestamp with time zone",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "gateway_tickets",
    columnName: "expires_at",
    dataType: "timestamp with time zone",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "gateway_tickets",
    columnName: "consumed_at",
    dataType: "timestamp with time zone",
    nullable: true,
    defaultValue: "none",
  },
  {
    tableName: "message_streams",
    columnName: "stream_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "message_streams",
    columnName: "target_type",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "message_streams",
    columnName: "target_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "message_streams",
    columnName: "last_sequence",
    dataType: "integer",
    nullable: false,
    defaultValue: "zero",
  },
  {
    tableName: "message_streams",
    columnName: "created_at",
    dataType: "timestamp with time zone",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "message_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "stream_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "sequence",
    dataType: "integer",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "sender_actor_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "target_type",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "target_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "client_message_id",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "content_type",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "content_text",
    dataType: "text",
    nullable: false,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "sent_at_client",
    dataType: "timestamp with time zone",
    nullable: true,
    defaultValue: "none",
  },
  {
    tableName: "messages",
    columnName: "created_at",
    dataType: "timestamp with time zone",
    nullable: false,
    defaultValue: "none",
  },
];

const LEGACY_CONSTRAINTS: readonly LegacyConstraint[] = [
  {
    tableName: "gateway_tickets",
    type: "p",
    definition: "PRIMARY KEY (ticket_hash)",
  },
  {
    tableName: "message_streams",
    type: "p",
    definition: "PRIMARY KEY (stream_id)",
  },
  {
    tableName: "messages",
    type: "p",
    definition: "PRIMARY KEY (message_id)",
  },
  {
    tableName: "messages",
    type: "f",
    definition: "FOREIGN KEY (stream_id) REFERENCES message_streams(stream_id)",
  },
  {
    tableName: "messages",
    type: "u",
    definition: "UNIQUE (stream_id, sequence)",
  },
  {
    tableName: "messages",
    type: "u",
    definition: "UNIQUE (sender_actor_id, stream_id, client_message_id)",
  },
];

const LEGACY_INDEXES: readonly LegacyIndex[] = [
  {
    tableName: "gateway_tickets",
    indexName: "gateway_tickets_expires_at_idx",
    unique: false,
    accessMethod: "btree",
    keyDefinitions: ["expires_at"],
    includedDefinitions: [],
    predicate: null,
    nullsNotDistinct: false,
  },
  {
    tableName: "gateway_tickets",
    indexName: "gateway_tickets_assigned_gateway_id_idx",
    unique: false,
    accessMethod: "btree",
    keyDefinitions: ["assigned_gateway_id"],
    includedDefinitions: [],
    predicate: null,
    nullsNotDistinct: false,
  },
  {
    tableName: "message_streams",
    indexName: "message_streams_target_idx",
    unique: true,
    accessMethod: "btree",
    keyDefinitions: ["target_type", "target_id"],
    includedDefinitions: [],
    predicate: null,
    nullsNotDistinct: false,
  },
  {
    tableName: "messages",
    indexName: "messages_stream_sequence_idx",
    unique: false,
    accessMethod: "btree",
    keyDefinitions: ["stream_id", "sequence"],
    includedDefinitions: [],
    predicate: null,
    nullsNotDistinct: false,
  },
];

export async function runRealtimeChatMigrations(
  db: MigrationDatabase,
  options: RealtimeChatMigrationRunnerOptions = {},
): Promise<void> {
  const migrations = options.migrations ?? REALTIME_CHAT_MIGRATIONS;
  const legacyBaselineVersion = options.legacyBaselineVersion ?? LEGACY_BASELINE_VERSION;
  assertMigrationDefinitions(migrations, legacyBaselineVersion);

  await db.connection().execute(async (connection) => {
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`.execute(connection);

    try {
      await createMigrationTable(connection);

      let appliedMigrations = await getAppliedMigrations(connection);
      let pendingMigrations = getPendingMigrations(appliedMigrations, migrations);

      if (appliedMigrations.length === 0 && pendingMigrations.length > 0) {
        const existingTables = await getExistingRealtimeChatTables(connection);

        if (existingTables.length > 0) {
          await assertLegacySchemaMatchesCurrent(connection, existingTables);
          await recordBaseline(
            connection,
            getLegacyBaselineMigration(pendingMigrations, legacyBaselineVersion),
          );
          appliedMigrations = await getAppliedMigrations(connection);
          pendingMigrations = getPendingMigrations(appliedMigrations, migrations);
        }
      }

      for (const migration of pendingMigrations) {
        await applyMigration(connection, migration);
      }
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.execute(connection);
    }
  });
}

function assertMigrationDefinitions(
  migrations: readonly RealtimeChatMigration[],
  legacyBaselineVersion: string,
): void {
  if (migrations.length === 0 || migrations[0]?.version !== legacyBaselineVersion) {
    throw new Error(
      `realtime-chat legacy baseline migration을 찾을 수 없습니다: ${legacyBaselineVersion}`,
    );
  }

  for (let index = 1; index < migrations.length; index += 1) {
    const previous = migrations[index - 1]!;
    const current = migrations[index]!;

    if (current.version <= previous.version) {
      throw new Error(
        `realtime-chat schema migration version이 순서대로 정의되지 않았습니다: ${current.version}`,
      );
    }
  }
}

function getLegacyBaselineMigration(
  pendingMigrations: readonly RealtimeChatMigration[],
  legacyBaselineVersion: string,
): RealtimeChatMigration {
  const baselineMigration = pendingMigrations.find(
    (migration) => migration.version === legacyBaselineVersion,
  );

  if (baselineMigration === undefined) {
    throw new Error(
      `realtime-chat legacy baseline migration을 적용 대기 목록에서 찾을 수 없습니다: ${legacyBaselineVersion}`,
    );
  }

  return baselineMigration;
}

function createChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function addMessageContentTypeTextConstraint(db: MigrationDatabase): Promise<void> {
  await sql.raw(ADD_MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT_SQL).execute(db);
  await sql.raw(VALIDATE_MESSAGE_CONTENT_TYPE_TEXT_CONSTRAINT_SQL).execute(db);
}

async function addMessageContentTextUtf8ByteLengthConstraint(db: MigrationDatabase): Promise<void> {
  await sql.raw("LOCK TABLE messages IN SHARE ROW EXCLUSIVE MODE").execute(db);

  const violations = await sql
    .raw<MessageContentTextByteLengthViolation>(MESSAGE_CONTENT_TEXT_UTF8_8KIB_AUDIT_SQL)
    .execute(db);

  if (violations.rows.length > 0) {
    throw new Error(
      `messages.content_text UTF-8 8KiB 제약을 적용할 수 없습니다. 위반 row: ${JSON.stringify(
        violations.rows,
      )}`,
    );
  }

  await sql.raw(ADD_MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT_SQL).execute(db);
  await sql.raw(VALIDATE_MESSAGE_CONTENT_TEXT_UTF8_8KIB_CONSTRAINT_SQL).execute(db);
}

async function createMigrationTable(db: MigrationDatabase): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL
    );
  `,
    )
    .execute(db);
}

async function getAppliedMigrations(db: MigrationDatabase): Promise<AppliedMigration[]> {
  const result = await sql<AppliedMigration>`
    SELECT version, name, checksum
    FROM realtime_chat_schema_migrations
    ORDER BY version ASC
  `.execute(db);

  return result.rows;
}

function getPendingMigrations(
  appliedMigrations: readonly AppliedMigration[],
  migrations: readonly RealtimeChatMigration[],
): RealtimeChatMigration[] {
  const appliedByVersion = new Map(
    appliedMigrations.map((migration) => [migration.version, migration]),
  );
  const expectedVersions = new Set(migrations.map((migration) => migration.version));
  let foundPendingMigration = false;

  for (const appliedMigration of appliedMigrations) {
    if (!expectedVersions.has(appliedMigration.version)) {
      throw new Error(
        `알 수 없는 realtime-chat schema migration version이 기록되어 있습니다: ${appliedMigration.version}`,
      );
    }
  }

  return migrations.filter((migration) => {
    const appliedMigration = appliedByVersion.get(migration.version);

    if (appliedMigration === undefined) {
      foundPendingMigration = true;
      return true;
    }

    if (foundPendingMigration) {
      throw new Error(
        `realtime-chat schema migration 이력이 순서대로 적용되지 않았습니다: ${migration.version}`,
      );
    }

    if (
      appliedMigration.name !== migration.name ||
      appliedMigration.checksum !== migration.checksum
    ) {
      throw new Error(
        `realtime-chat schema migration 무결성 검증에 실패했습니다: ${migration.version}`,
      );
    }

    return false;
  });
}

async function getExistingRealtimeChatTables(
  db: MigrationDatabase,
): Promise<(typeof REALTIME_CHAT_TABLES)[number][]> {
  const result = await sql<{ table_name: (typeof REALTIME_CHAT_TABLES)[number] }>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('gateway_tickets', 'message_streams', 'messages')
      AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `.execute(db);

  return result.rows.map((row) => row.table_name);
}

async function assertLegacySchemaMatchesCurrent(
  db: MigrationDatabase,
  existingTables: readonly (typeof REALTIME_CHAT_TABLES)[number][],
): Promise<void> {
  if (existingTables.length !== REALTIME_CHAT_TABLES.length) {
    throwLegacySchemaMismatch("현재 realtime-chat 테이블이 모두 존재하지 않습니다");
  }

  await Promise.all([
    assertLegacyColumns(db),
    assertLegacyConstraints(db),
    assertLegacyIndexes(db),
  ]);
}

async function assertLegacyColumns(db: MigrationDatabase): Promise<void> {
  const result = await sql<{
    table_name: (typeof REALTIME_CHAT_TABLES)[number];
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('gateway_tickets', 'message_streams', 'messages')
    ORDER BY table_name ASC, ordinal_position ASC
  `.execute(db);

  if (result.rows.length !== LEGACY_COLUMNS.length) {
    throwLegacySchemaMismatch("테이블 column 수가 현재 schema와 다릅니다");
  }

  for (const expectedColumn of LEGACY_COLUMNS) {
    const actualColumn = result.rows.find(
      (column) =>
        column.table_name === expectedColumn.tableName &&
        column.column_name === expectedColumn.columnName,
    );

    if (
      actualColumn === undefined ||
      actualColumn.data_type !== expectedColumn.dataType ||
      (actualColumn.is_nullable === "YES") !== expectedColumn.nullable ||
      !matchesExpectedDefault(actualColumn.column_default, expectedColumn.defaultValue)
    ) {
      throwLegacySchemaMismatch(
        `${expectedColumn.tableName}.${expectedColumn.columnName} column 정의가 현재 schema와 다릅니다`,
      );
    }
  }
}

function matchesExpectedDefault(
  actualDefault: string | null,
  expectedDefault: LegacyColumn["defaultValue"],
): boolean {
  if (expectedDefault === "none") {
    return actualDefault === null;
  }

  return actualDefault === "0" || actualDefault === "0::integer";
}

async function assertLegacyConstraints(db: MigrationDatabase): Promise<void> {
  const result = await sql<{
    table_name: (typeof REALTIME_CHAT_TABLES)[number];
    constraint_type: LegacyConstraint["type"];
    definition: string;
  }>`
    SELECT table_relation.relname AS table_name,
      constraint_definition.contype AS constraint_type,
      pg_get_constraintdef(constraint_definition.oid, true) AS definition
    FROM pg_catalog.pg_constraint constraint_definition
    JOIN pg_catalog.pg_class table_relation ON table_relation.oid = constraint_definition.conrelid
    JOIN pg_catalog.pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
    WHERE table_namespace.nspname = current_schema()
      AND table_relation.relname IN ('gateway_tickets', 'message_streams', 'messages')
      AND constraint_definition.contype IN ('c', 'f', 'p', 'u', 'x')
  `.execute(db);

  assertExactSet(
    result.rows.map((constraint) =>
      createConstraintSignature(
        constraint.table_name,
        constraint.constraint_type,
        constraint.definition,
      ),
    ),
    LEGACY_CONSTRAINTS.map((constraint) =>
      createConstraintSignature(constraint.tableName, constraint.type, constraint.definition),
    ),
    "constraint",
  );
}

async function assertLegacyIndexes(db: MigrationDatabase): Promise<void> {
  const result = await sql<{
    table_name: (typeof REALTIME_CHAT_TABLES)[number];
    index_name: string;
    is_unique: boolean;
    access_method: string;
    key_definitions: string[] | string;
    included_definitions: string[] | string;
    predicate: string | null;
    nulls_not_distinct: boolean;
    is_valid: boolean;
    is_ready: boolean;
    is_live: boolean;
  }>`
    SELECT table_relation.relname AS table_name, index_relation.relname AS index_name,
      index_definition.indisunique AS is_unique,
      access_method.amname AS access_method,
      COALESCE(
        array_agg(pg_get_indexdef(index_definition.indexrelid, index_column.position, true)
          ORDER BY index_column.position)
          FILTER (WHERE index_column.position <= index_definition.indnkeyatts),
        ARRAY[]::text[]
      ) AS key_definitions,
      COALESCE(
        array_agg(pg_get_indexdef(index_definition.indexrelid, index_column.position, true)
          ORDER BY index_column.position)
          FILTER (WHERE index_column.position > index_definition.indnkeyatts),
        ARRAY[]::text[]
      ) AS included_definitions,
      pg_get_expr(index_definition.indpred, index_definition.indrelid, true) AS predicate,
      index_definition.indnullsnotdistinct AS nulls_not_distinct,
      index_definition.indisvalid AS is_valid,
      index_definition.indisready AS is_ready,
      index_definition.indislive AS is_live
    FROM pg_catalog.pg_index index_definition
    JOIN pg_catalog.pg_class table_relation ON table_relation.oid = index_definition.indrelid
    JOIN pg_catalog.pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
    JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_definition.indexrelid
    JOIN pg_catalog.pg_am access_method ON access_method.oid = index_relation.relam
    JOIN LATERAL generate_series(1, index_definition.indnatts) AS index_column(position) ON true
    WHERE table_namespace.nspname = current_schema()
      AND table_relation.relname IN ('gateway_tickets', 'message_streams', 'messages')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint constraint_definition
        WHERE constraint_definition.conindid = index_definition.indexrelid
      )
    GROUP BY table_relation.relname, index_relation.relname, index_definition.indexrelid,
      index_definition.indisunique, index_definition.indnkeyatts, index_definition.indpred,
      index_definition.indrelid, index_definition.indnullsnotdistinct,
      index_definition.indisvalid, index_definition.indisready, index_definition.indislive,
      access_method.amname
  `.execute(db);

  assertExactSet(
    result.rows.map((index) =>
      createIndexSignature(
        index.table_name,
        index.index_name,
        index.is_unique,
        index.access_method,
        normalizePostgresArray(index.key_definitions),
        normalizePostgresArray(index.included_definitions),
        index.predicate,
        index.nulls_not_distinct,
        index.is_valid,
        index.is_ready,
        index.is_live,
      ),
    ),
    LEGACY_INDEXES.map((index) =>
      createIndexSignature(
        index.tableName,
        index.indexName,
        index.unique,
        index.accessMethod,
        index.keyDefinitions,
        index.includedDefinitions,
        index.predicate,
        index.nullsNotDistinct,
        true,
        true,
        true,
      ),
    ),
    "secondary index",
  );
}

function createConstraintSignature(tableName: string, type: string, definition: string): string {
  return JSON.stringify({ tableName, type, definition });
}

function createIndexSignature(
  tableName: string,
  indexName: string,
  isUnique: boolean,
  accessMethod: string,
  keyDefinitions: readonly string[],
  includedDefinitions: readonly string[],
  predicate: string | null,
  nullsNotDistinct: boolean,
  isValid: boolean,
  isReady: boolean,
  isLive: boolean,
): string {
  return JSON.stringify({
    tableName,
    indexName,
    isUnique,
    accessMethod,
    keyDefinitions,
    includedDefinitions,
    predicate,
    nullsNotDistinct,
    isValid,
    isReady,
    isLive,
  });
}

function normalizePostgresArray(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === "{}") {
    return [];
  }

  return value.slice(1, -1).split(",");
}

function assertExactSet(
  actualValues: readonly string[],
  expectedValues: readonly string[],
  label: string,
): void {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);

  if (
    actual.size !== expected.size ||
    actualValues.length !== actual.size ||
    expectedValues.some((expectedValue) => !actual.has(expectedValue))
  ) {
    throwLegacySchemaMismatch(`${label} 정의가 현재 schema와 다릅니다`);
  }
}

function throwLegacySchemaMismatch(detail: string): never {
  throw new Error(
    `기존 realtime-chat schema를 baseline으로 기록할 수 없습니다: ${detail}. migration 이력을 기록하지 않았습니다.`,
  );
}

async function recordBaseline(
  db: MigrationDatabase,
  migration: RealtimeChatMigration,
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await recordMigration(transaction, migration);
  });
}

async function applyMigration(
  db: MigrationDatabase,
  migration: RealtimeChatMigration,
): Promise<void> {
  if (migration.transaction === "required") {
    await db.transaction().execute(async (transaction) => {
      await migration.execute(transaction);
      await recordMigration(transaction, migration);
    });
    return;
  }

  await migration.execute(db);
  await recordMigration(db, migration);
}

async function recordMigration(
  db: MigrationDatabase,
  migration: RealtimeChatMigration,
): Promise<void> {
  await sql`
    INSERT INTO realtime_chat_schema_migrations (version, name, checksum, applied_at)
    VALUES (${migration.version}, ${migration.name}, ${migration.checksum}, now())
  `.execute(db);
}
