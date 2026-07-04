import type {
  GatewayTicket,
  ISODateTime,
  UserId,
  WorkspaceId
} from '../primitives';

export type IssueGatewayTicketRequest = {
  actorId: UserId;
  workspaceId?: WorkspaceId;
};

export type IssueGatewayTicketResponse = {
  ticket: GatewayTicket;
  gatewayUrl?: string;
  expiresAt: ISODateTime;
};
