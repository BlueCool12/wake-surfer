import type {
  GatewayTicket,
  ISODateTime,
  UserId,
  WorkspaceId
} from '../primitives';
import type { RealtimeChatErrorCode } from '../error-codes';

export type IssueGatewayTicketRequest = {
  actorId: UserId;
  workspaceId?: WorkspaceId;
};

export type IssueGatewayTicketResponse = {
  ticket: GatewayTicket;
  gatewayUrl?: string;
  expiresAt: ISODateTime;
};

export type ConsumeGatewayTicketRequest = {
  ticket: GatewayTicket;
};

export type ConsumeGatewayTicketResponse =
  | {
      status: 'consumed';
      ticket: {
        actorId: UserId;
        workspaceId?: WorkspaceId;
        consumedAt: ISODateTime;
      };
    }
  | {
      status: 'rejected';
      reason: RealtimeChatErrorCode;
      message?: string;
    };
