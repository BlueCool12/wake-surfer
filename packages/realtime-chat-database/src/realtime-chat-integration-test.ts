import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createRealtimeChatDatabase } from "./realtime-chat-database";
import type { RealtimeChatDatabaseHandle } from "./realtime-chat-database";

export type RealtimeChatIntegrationTestDatabase = {
  db: RealtimeChatDatabaseHandle["db"];
  schemaName: string;
  close: () => Promise<void>;
};

/**
 * `TEST_DATABASE_URL`로 지정한 PostgreSQL 안에 독립 schema를 만들고 공통 realtime-chat bootstrap을 적용한다.
 * 각 테스트 suite는 이 함수를 한 번 호출하고 `afterAll`에서 반환값의 `close()`를 호출해야 한다.
 */
export async function createRealtimeChatIntegrationTestDatabase(): Promise<RealtimeChatIntegrationTestDatabase> {
  const databaseUrl = getTestDatabaseUrl();
  const schemaName = createSchemaName();
  const adminPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
  });
  let database: RealtimeChatDatabaseHandle | undefined;
  let schemaCreated = false;

  try {
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    schemaCreated = true;

    database = createRealtimeChatDatabase({
      databaseUrl: createSchemaScopedDatabaseUrl(databaseUrl, schemaName),
    });
    await database.migrate();

    return {
      db: database.db,
      schemaName,
      close: createCleanup(database, adminPool, schemaName),
    };
  } catch (error) {
    await cleanupAfterBootstrapFailure(database, adminPool, schemaName, schemaCreated, error);
    throw error;
  }
}

function getTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error(
      "PostgreSQL 통합 테스트에는 TEST_DATABASE_URL 환경 변수가 필요합니다. 운영 databaseUrl로 대체하지 마세요.",
    );
  }

  return databaseUrl;
}

function createSchemaName(): string {
  return `realtime_chat_it_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "")}`;
}

function createSchemaScopedDatabaseUrl(databaseUrl: string, schemaName: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL은 유효한 PostgreSQL 연결 URL이어야 합니다.");
  }

  const existingOptions = parsed.searchParams.get("options");
  const searchPathOption = `-c search_path=${schemaName}`;

  parsed.searchParams.set(
    "options",
    existingOptions === null ? searchPathOption : `${existingOptions} ${searchPathOption}`,
  );

  return parsed.toString();
}

function createCleanup(
  database: RealtimeChatDatabaseHandle,
  adminPool: Pool,
  schemaName: string,
): () => Promise<void> {
  let closed = false;

  return async () => {
    if (closed) {
      return;
    }

    closed = true;
    await closeDatabaseAndDropSchema(database, adminPool, schemaName);
  };
}

async function cleanupAfterBootstrapFailure(
  database: RealtimeChatDatabaseHandle | undefined,
  adminPool: Pool,
  schemaName: string,
  schemaCreated: boolean,
  bootstrapError: unknown,
): Promise<void> {
  try {
    await closeDatabaseAndDropSchema(database, adminPool, schemaName, schemaCreated);
  } catch (cleanupError) {
    throw new AggregateError(
      [bootstrapError, cleanupError],
      "PostgreSQL 통합 테스트 bootstrap과 임시 schema 정리가 모두 실패했습니다.",
    );
  }
}

async function closeDatabaseAndDropSchema(
  database: RealtimeChatDatabaseHandle | undefined,
  adminPool: Pool,
  schemaName: string,
  schemaCreated = true,
): Promise<void> {
  let databaseCloseError: unknown;

  try {
    await database?.close();
  } catch (error) {
    databaseCloseError = error;
  }

  if (schemaCreated) {
    try {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    } finally {
      await adminPool.end();
    }
  } else {
    await adminPool.end();
  }

  if (databaseCloseError !== undefined) {
    throw databaseCloseError;
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
