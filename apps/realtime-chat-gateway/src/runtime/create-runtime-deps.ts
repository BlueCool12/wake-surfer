import type { RealtimeChatGatewayRuntimeDeps } from '@wake-surfer/realtime-chat/gateway';
import type { LoggerPort } from '@wake-surfer/realtime-chat/gateway';
import type { AppEnv } from '../config/env';
import { createNodeIdGenerator } from './id-generator';
import { createNoopMetrics } from './metrics';
import { createLoggingOutboundEventBus } from './outbound-event-bus';
import { createHttpRealtimeChatApiClient } from './realtime-chat-api-client';
import { createPostgresGatewayTicketConsumePort } from './postgres-gateway-ticket-port';
import { createNodeGatewayTicketHasher } from './ticket-hasher';

type RuntimeTicketPort = RealtimeChatGatewayRuntimeDeps['gatewayTicketPort'] & {
  destroy?: () => Promise<void>;
};

export type RealtimeChatGatewayRuntimeHandle = {
  deps: RealtimeChatGatewayRuntimeDeps;
  close: () => Promise<void>;
};

export async function createRealtimeChatGatewayRuntimeDeps(
  env: AppEnv,
  logger: LoggerPort
): Promise<RealtimeChatGatewayRuntimeHandle> {
  const ticketPort: RuntimeTicketPort =
    await createPostgresGatewayTicketConsumePort(
      env.DATABASE_URL,
      createNodeGatewayTicketHasher()
    );

  return {
    deps: {
      chatApiClient: createHttpRealtimeChatApiClient(
        env.REALTIME_CHAT_API_BASE_URL
      ),
      gatewayTicketPort: ticketPort,
      outboundEventBus: createLoggingOutboundEventBus(logger),
      clock: {
        now: () => new Date()
      },
      idGenerator: createNodeIdGenerator(),
      logger,
      metrics: createNoopMetrics()
    },
    close: async () => {
      await ticketPort.destroy?.();
    }
  };
}
