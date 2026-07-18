import { z } from "zod";

export * from "./gateway-session";

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

const NonBlankStringSchema = z.string().trim().min(1);
const GatewayUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "ws:" || protocol === "wss:";
}, "gatewayUrl은 WebSocket URL이어야 합니다.");
const ISODateTimeSchema = z
  .string()
  .trim()
  .pipe(z.iso.datetime({ offset: true }));

export const IssueGatewayTicketResponseSchema = z.strictObject({
  ticket: NonBlankStringSchema,
  gatewayUrl: GatewayUrlSchema,
  expiresAt: ISODateTimeSchema,
});

export const IssueGatewayTicketRequestBodySchema = z.strictObject({});

export type IssueGatewayTicketRequest = z.infer<typeof IssueGatewayTicketRequestBodySchema>;

export const ConsumeGatewayTicketRequestBodySchema = z.strictObject({
  ticket: NonBlankStringSchema,
});

export type ConsumeGatewayTicketRequest = z.infer<typeof ConsumeGatewayTicketRequestBodySchema>;

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
