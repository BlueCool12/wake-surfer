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

export const ConsumeGatewayTicketResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("consumed"),
    ticket: z.strictObject({
      actorId: z.string().trim().min(1),
      consumedAt: z.iso.datetime(),
    }),
  }),
  z.strictObject({
    status: z.literal("rejected"),
    reason: z.literal("invalid_or_expired"),
  }),
]);

export type ConsumeGatewayTicketResponse = z.infer<typeof ConsumeGatewayTicketResponseSchema>;
