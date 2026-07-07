import type { GatewayId, GatewayTicket, ISODateTime, UserId } from "../primitives";
import type { RealtimeChatErrorCode } from "../error-codes";

export type IssueGatewayTicketRequest = Record<never, never>;

export type IssueGatewayTicketResponse = {
  ticket: GatewayTicket;
  gatewayUrl: string;
  expiresAt: ISODateTime;
};

export type ConsumeGatewayTicketRequest = {
  ticket: GatewayTicket;
  gatewayId: GatewayId;
};

export type ConsumeGatewayTicketResponse =
  | {
      status: "consumed";
      ticket: {
        actorId: UserId;
        consumedAt: ISODateTime;
      };
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };
