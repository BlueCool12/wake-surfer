import type { LoggerPort, OutboundEventBusPort } from "@wake-surfer/realtime-chat/api";

export function createLoggingOutboundEventBus(logger: LoggerPort): OutboundEventBusPort {
  return {
    async publish(event) {
      logger.info("realtime chat outbound delivery requested", {
        eventId: event.eventId,
        streamId: event.streamId,
        messageId: event.messageId,
        recipientCount: event.recipientUserIds.length,
      });
    },
  };
}
