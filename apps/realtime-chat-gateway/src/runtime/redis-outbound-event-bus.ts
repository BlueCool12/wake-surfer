import { createClient } from "redis";
import type { LoggerPort, OutboundEventBusPort } from "@wake-surfer/realtime-chat/gateway";
import type { OutboundMessageDeliveryRequested } from "@wake-surfer/realtime-chat-contracts";

export type RedisOutboundEventBus = OutboundEventBusPort & {
  destroy: () => Promise<void>;
};

export async function createRedisOutboundEventBus(input: {
  redisUrl: string;
  channel: string;
  logger: LoggerPort;
}): Promise<RedisOutboundEventBus> {
  const subscriber = createClient({
    url: input.redisUrl,
  });

  subscriber.on("error", (error) => {
    input.logger.error("realtime chat redis subscriber error", { error });
  });

  await subscriber.connect();

  return {
    async subscribe(handler) {
      await subscriber.subscribe(input.channel, async (message) => {
        const event = parseOutboundEvent(message, input.logger);

        if (!event) {
          return;
        }

        try {
          await handler(event);
        } catch (error) {
          input.logger.warn("failed to handle realtime chat outbound event", {
            error,
            eventId: event.eventId,
          });
        }
      });

      return {
        async unsubscribe() {
          await subscriber.unsubscribe(input.channel);
        },
      };
    },
    async destroy() {
      if (subscriber.isOpen) {
        await subscriber.quit();
      }
    },
  };
}

function parseOutboundEvent(
  message: string,
  logger: LoggerPort,
): OutboundMessageDeliveryRequested | undefined {
  try {
    const parsed = JSON.parse(message) as Partial<OutboundMessageDeliveryRequested>;

    if (parsed.eventType !== "OutboundMessageDeliveryRequested") {
      logger.warn("unsupported realtime chat outbound event ignored", {
        eventType: parsed.eventType,
      });
      return undefined;
    }

    return parsed as OutboundMessageDeliveryRequested;
  } catch (error) {
    logger.warn("invalid realtime chat outbound event payload ignored", {
      error,
    });
    return undefined;
  }
}
