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
  gatewayId: z.string().trim().min(1),
});

export function parseConsumeGatewayTicketRequestBody(
  body: unknown,
): ConsumeGatewayTicketRequestBodyParseResult {
  const parsed = ConsumeGatewayTicketRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];

    return {
      ok: false,
      message: firstIssue?.message ?? "consume gateway ticket request body is invalid",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}
