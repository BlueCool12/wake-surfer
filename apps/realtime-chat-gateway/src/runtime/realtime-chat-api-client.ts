import { ConsumeGatewayTicketResponseSchema } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type { GatewayTicketConsumer } from "../ports/gateway-ticket-consumer.js";

export type GatewayTicketApiClient = GatewayTicketConsumer;

export type CreateGatewayTicketApiClientConfig = {
  apiBaseUrl: string;
  gatewayIdHeader: string;
};

export function createGatewayTicketApiClient(
  config: CreateGatewayTicketApiClientConfig,
): GatewayTicketApiClient {
  const apiBaseUrl = config.apiBaseUrl.replace(/\/$/, "");

  return {
    consumeGatewayTicket: async ({ gatewayId, requestId, signal, ticket }) => {
      const response = await fetch(`${apiBaseUrl}/internal/realtime-chat/gateway-tickets/consume`, {
        body: JSON.stringify({ ticket }),
        headers: {
          "content-type": "application/json",
          [config.gatewayIdHeader]: gatewayId,
          "x-request-id": requestId,
        },
        method: "POST",
        signal,
      });

      const body: unknown = await response.json().catch(() => undefined);

      if (!response.ok) {
        throw new Error(
          `게이트웨이 티켓 소비 요청 실패: ${response.status} ${JSON.stringify(body)}`,
        );
      }

      const parsed = ConsumeGatewayTicketResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new Error("게이트웨이 티켓 소비 응답 형식이 올바르지 않습니다");
      }

      return parsed.data;
    },
  };
}
