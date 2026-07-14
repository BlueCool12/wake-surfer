import type { ConsumeGatewayTicketResponse } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

export type GatewayTicketConsumer = {
  consumeGatewayTicket: (request: {
    gatewayId: string;
    requestId: string;
    signal: AbortSignal;
    ticket: string;
  }) => Promise<ConsumeGatewayTicketResponse>;
};
