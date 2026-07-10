import { z } from "zod";
import type { ConsumeGatewayTicketRequest } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

export type ConsumeGatewayTicketRequestBodyParseResult =
  | {
      ok: true;
      value: ConsumeGatewayTicketRequest;
    }
  | {
      ok: false;
      message: string;
    };

const ConsumeGatewayTicketRequestBodySchema = z.strictObject({
  ticket: z.string().trim().min(1),
});

export function parseConsumeGatewayTicketRequestBody(
  body: unknown,
): ConsumeGatewayTicketRequestBodyParseResult {
  const parsed = ConsumeGatewayTicketRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      message: "게이트웨이 티켓 소비 요청 본문이 올바르지 않습니다.",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}
