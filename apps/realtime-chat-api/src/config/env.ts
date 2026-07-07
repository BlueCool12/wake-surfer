import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.string().min(1),
  HOST: z.string().min(1),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.string().min(1),
  REALTIME_CHAT_BASE_PATH: z.string().min(1),
  REALTIME_CHAT_GATEWAY_ID: z.string().min(1),
  REALTIME_CHAT_GATEWAY_URL: z.string().url(),
  GATEWAY_TICKET_TTL_SECONDS: z.coerce.number().int().positive(),
  MAX_MESSAGE_TEXT_LENGTH: z.coerce.number().int().positive(),
  SYNC_DEFAULT_LIMIT: z.coerce.number().int().positive(),
  SYNC_MAX_LIMIT: z.coerce.number().int().positive(),
  REDIS_URL: z.string().url(),
  REALTIME_CHAT_OUTBOUND_CHANNEL: z.string().min(1),
  DATABASE_URL: z.preprocess(emptyStringToUndefined, z.string().optional()),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}
