import type { GatewayTicketDatabase } from "@wake-surfer/realtime-chat-gateway-ticket/table-contract";
import type { MessageSendDatabase } from "@wake-surfer/realtime-chat-message-send/table-contract";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

export type RealtimeChatDatabase = GatewayTicketDatabase & MessageSendDatabase;

export type RealtimeChatDatabasePoolConfig = {
  max?: number;
  min?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  maxLifetimeSeconds?: number;
  maxUses?: number;
  allowExitOnIdle?: boolean;
  statementTimeoutMillis?: number;
};

export type CreateRealtimeChatDatabaseConfig = {
  databaseUrl: string;
  pool?: RealtimeChatDatabasePoolConfig;
};

export type RealtimeChatDatabaseHandle = {
  db: Kysely<RealtimeChatDatabase>;
  close: () => Promise<void>;
};

export function createRealtimeChatDatabase(
  config: CreateRealtimeChatDatabaseConfig,
): RealtimeChatDatabaseHandle {
  assertDatabaseUrl(config.databaseUrl);
  const { statementTimeoutMillis, ...poolConfig } = config.pool ?? {};

  const db = new Kysely<RealtimeChatDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: config.databaseUrl,
        ...poolConfig,
        statement_timeout: statementTimeoutMillis,
      }),
    }),
  });

  return {
    db,
    close() {
      return db.destroy();
    },
  };
}

function assertDatabaseUrl(databaseUrl: string): void {
  if (databaseUrl.trim().length === 0) {
    throw new Error("실시간 채팅 databaseUrl은 비어 있을 수 없습니다.");
  }
}
