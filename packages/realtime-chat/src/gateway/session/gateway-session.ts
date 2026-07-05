import type {
  GatewayId,
  GatewaySessionId,
  ISODateTime,
  UserId,
  WorkspaceId,
} from "@wake-surfer/realtime-chat-contracts";
import type { WebSocketConnectionLike } from "../websocket/websocket-server-like";

export type GatewaySession = {
  sessionId: GatewaySessionId;
  userId: UserId;
  gatewayId: GatewayId;
  connectedAt: ISODateTime;
  connection: WebSocketConnectionLike;
  workspaceId?: WorkspaceId;
};
