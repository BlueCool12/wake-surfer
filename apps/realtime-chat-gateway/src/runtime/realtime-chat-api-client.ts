import type { ConsumeGatewayTicketResponse } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

export type GatewayTicketApiClient = {
  consumeGatewayTicket: (request: {
    gatewayId: string;
    requestId: string;
    signal: AbortSignal;
    ticket: string;
  }) => Promise<ConsumeGatewayTicketResponse>;
};

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

      if (!isConsumeGatewayTicketResponse(body)) {
        throw new Error("게이트웨이 티켓 소비 응답 형식이 올바르지 않습니다");
      }

      return body;
    },
  };
}

function isConsumeGatewayTicketResponse(value: unknown): value is ConsumeGatewayTicketResponse {
  if (!isRecord(value) || typeof value.status !== "string") {
    return false;
  }

  if (value.status === "rejected") {
    return value.reason === "invalid_or_expired";
  }

  if (value.status !== "consumed" || !isRecord(value.ticket)) {
    return false;
  }

  return typeof value.ticket.actorId === "string" && typeof value.ticket.consumedAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
