import { z } from "zod";

export type ActorId = string;
export type GatewayTicket = string;
export type GatewayUrl = string;
export type ISODateTime = string;

export type RealtimeChatErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "gateway_ticket_rejected"
  | "gateway_ticket_unavailable";

export type GatewayTicketRejectedReason = "invalid_or_expired";

export type IssueGatewayTicketResponse = {
  ticket: GatewayTicket;
  gatewayUrl: GatewayUrl;
  expiresAt: ISODateTime;
};

export const IssueGatewayTicketRequestBodySchema = z.strictObject({});

export type IssueGatewayTicketRequest = z.infer<typeof IssueGatewayTicketRequestBodySchema>;

export const ConsumeGatewayTicketRequestBodySchema = z.strictObject({
  ticket: z.string().trim().min(1),
});

export type ConsumeGatewayTicketRequest = z.infer<typeof ConsumeGatewayTicketRequestBodySchema>;

export type IssueGatewayTicketRequestBodyParseResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

export type ConsumeGatewayTicketRequestBodyParseResult =
  | {
      ok: true;
      value: ConsumeGatewayTicketRequest;
    }
  | {
      ok: false;
      message: string;
    };

export function parseIssueGatewayTicketRequestBody(
  body: unknown,
): IssueGatewayTicketRequestBodyParseResult {
  if (body === undefined || body === null) {
    return {
      ok: true,
    };
  }

  const parsed = IssueGatewayTicketRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      message:
        "게이트웨이 티켓 발급 요청 본문에는 클라이언트가 소유한 actor 또는 workspace 필드를 포함할 수 없습니다.",
    };
  }

  return {
    ok: true,
  };
}

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

export type ConsumeGatewayTicketResponse =
  | {
      status: "consumed";
      ticket: {
        actorId: ActorId;
        consumedAt: ISODateTime;
      };
    }
  | {
      status: "rejected";
      reason: GatewayTicketRejectedReason;
    };
