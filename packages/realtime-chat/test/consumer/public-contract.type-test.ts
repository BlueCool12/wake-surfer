import {
  mountRealtimeChatApi,
  mountRealtimeChatGateway,
  type RealtimeChatApiRuntimeDeps,
  type RealtimeChatGatewayRuntimeDeps,
} from "@wake-surfer/realtime-chat";
import {
  mountRealtimeChatApi as mountRealtimeChatApiFromSubpath,
  type HttpServerLike,
  type RealtimeChatApiMountOptions,
} from "@wake-surfer/realtime-chat/api";
import {
  mountRealtimeChatGateway as mountRealtimeChatGatewayFromSubpath,
  type RealtimeChatGatewayMountOptions,
  type WebSocketServerLike,
} from "@wake-surfer/realtime-chat/gateway";
import type {
  ConsumeGatewayTicketRequest,
  IssueGatewayTicketRequest,
} from "@wake-surfer/realtime-chat-contracts";

declare const httpServer: HttpServerLike;
declare const webSocketServer: WebSocketServerLike;
declare const apiDeps: RealtimeChatApiRuntimeDeps;
declare const gatewayDeps: RealtimeChatGatewayRuntimeDeps;

const apiOptions: RealtimeChatApiMountOptions = {
  basePath: "/api/realtime-chat",
  gatewayTicketTtlSeconds: 60,
  gatewayUrl: "wss://example.test/ws/realtime-chat",
};

const apiOptionsWithoutAdvertisedGatewayUrl: RealtimeChatApiMountOptions = {
  basePath: "/api/realtime-chat",
  gatewayTicketTtlSeconds: 60,
};

const gatewayOptions: RealtimeChatGatewayMountOptions = {
  path: "/ws/realtime-chat",
  gatewayId: "gateway-1",
};

void mountRealtimeChatApi(httpServer, apiOptions, apiDeps);
void mountRealtimeChatApiFromSubpath(httpServer, apiOptionsWithoutAdvertisedGatewayUrl, apiDeps);
void mountRealtimeChatGateway(webSocketServer, gatewayOptions, gatewayDeps);
void mountRealtimeChatGatewayFromSubpath(webSocketServer, gatewayOptions, gatewayDeps);

const removedApiOption: RealtimeChatApiMountOptions = {
  basePath: "/api/realtime-chat",
  // @ts-expect-error gateway ticket TTL은 ticketTtlSeconds가 아니라 gatewayTicketTtlSeconds로 주입한다.
  ticketTtlSeconds: 60,
};
void removedApiOption;

declare const issueGatewayTicketRequest: IssueGatewayTicketRequest;
declare const consumeGatewayTicketRequest: ConsumeGatewayTicketRequest;

const actorId: string | undefined = issueGatewayTicketRequest.actorId;
const workspaceId: string | undefined = issueGatewayTicketRequest.workspaceId;

void actorId;
void workspaceId;
const rawTicket: string = consumeGatewayTicketRequest.ticket;

void rawTicket;

// @ts-expect-error request DTO는 gateway ticket TTL override를 노출하지 않는다.
const ttlSecondsOverride = issueGatewayTicketRequest.ttlSeconds;
void ttlSecondsOverride;

// @ts-expect-error request DTO는 advertised gateway URL override를 노출하지 않는다.
const gatewayUrlOverride = issueGatewayTicketRequest.gatewayUrl;
void gatewayUrlOverride;
