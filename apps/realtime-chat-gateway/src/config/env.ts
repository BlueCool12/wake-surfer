import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().min(1),
  HOST: z.string().min(1),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.string().min(1),
  REALTIME_CHAT_GATEWAY_PATH: z.string().min(1),
  GATEWAY_ID: z.string().min(1),
  REALTIME_CHAT_API_BASE_URL: z.string().url(),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1)
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}
