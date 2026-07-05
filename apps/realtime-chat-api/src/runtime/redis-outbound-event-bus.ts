import { createClient } from 'redis';
import type {
  LoggerPort,
  OutboundEventBusPort
} from '@wake-surfer/realtime-chat/api';

export type RedisOutboundEventBus = OutboundEventBusPort & {
  destroy: () => Promise<void>;
};

export async function createRedisOutboundEventBus(input: {
  redisUrl: string;
  channel: string;
  logger: LoggerPort;
}): Promise<RedisOutboundEventBus> {
  const client = createClient({
    url: input.redisUrl
  });

  client.on('error', (error) => {
    input.logger.error('realtime chat redis publisher error', { error });
  });

  await client.connect();

  return {
    async publish(event) {
      await client.publish(input.channel, JSON.stringify(event));
    },
    async destroy() {
      if (client.isOpen) {
        await client.quit();
      }
    }
  };
}
