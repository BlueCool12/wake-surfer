import type { LoggerPort, OutboundEventBusPort } from "@wake-surfer/realtime-chat/gateway";

export function createLoggingOutboundEventBus(logger: LoggerPort): OutboundEventBusPort {
  return {
    subscribe() {
      logger.info("realtime chat gateway outbound subscriber registered", {
        mode: "logging-only",
      });

      return {
        unsubscribe() {
          logger.info("realtime chat gateway outbound subscriber released", {
            mode: "logging-only",
          });
        },
      };
    },
  };
}
