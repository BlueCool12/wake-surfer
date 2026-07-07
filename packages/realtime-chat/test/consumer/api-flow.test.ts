import { describe, expect, it, vi } from "vitest";
import { mountRealtimeChatApi } from "@wake-surfer/realtime-chat/api";
import type {
  MarkReadCursorRequest,
  SendChannelMessageRequest,
} from "@wake-surfer/realtime-chat-contracts";
import {
  createApiRuntimeDeps,
  createHttpServerDouble,
  fixedNow,
  httpRequest,
} from "./test-doubles";

describe("consumer API mount flow", () => {
  it("basePath 아래에 문서화된 HTTP route를 등록한다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps();

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: " /api/realtime-chat/ ",
      },
      deps,
    );

    expect(http.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "POST /api/realtime-chat/gateway-tickets",
      "POST /api/realtime-chat/internal/gateway-tickets/consume",
      "POST /api/realtime-chat/internal/messages/channel",
      "POST /api/realtime-chat/internal/messages/dm",
      "POST /api/realtime-chat/internal/messages/thread-replies",
      "POST /api/realtime-chat/internal/read-cursors",
      "GET /api/realtime-chat/streams/:streamId/messages",
      "POST /api/realtime-chat/internal/system-messages/session-started",
    ]);
  });

  it("gateway ticket은 인증 actor와 배정 정책 결과로 발급한다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps();

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: "/api/realtime-chat",
        gatewayTicketTtlSeconds: 120,
      },
      deps,
    );

    const response = await http.findRoute("POST", "/api/realtime-chat/gateway-tickets").handler(
      httpRequest({
        headers: {
          "x-actor-id": " user-1 ",
        },
        body: {
          actorId: "attacker",
          workspaceId: "workspace-1",
          ttlSeconds: 999,
          gatewayUrl: "wss://request.example/ws",
        },
      }),
    );

    expect(response).toEqual({
      status: 201,
      body: {
        ticket: "gateway-ticket-1.gateway-ticket-secret-2",
        gatewayUrl: "wss://public.example/ws/realtime-chat",
        expiresAt: "2026-01-01T00:02:00.000Z",
      },
    });
    expect(deps.gatewayAssignmentPort.assignGatewayForTicket).toHaveBeenCalledWith({
      actorId: "user-1",
    });
    expect(deps.db.issueGatewayTicket).toHaveBeenCalledWith({
      ticketValueHash: "hash:gateway-ticket-1.gateway-ticket-secret-2",
      actorId: "user-1",
      assignedGatewayId: "gateway-1",
      issuedAt: fixedNow.toISOString(),
      expiresAt: "2026-01-01T00:02:00.000Z",
    });
  });

  it("gateway ticket actor는 request body가 아니라 인증 context에서 읽는다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps();

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: "/api/realtime-chat",
      },
      deps,
    );

    const response = await http.findRoute("POST", "/api/realtime-chat/gateway-tickets").handler(
      httpRequest({
        headers: {
          "x-actor-id": " user-from-header ",
        },
        body: {
          actorId: "body-user",
          workspaceId: "workspace-1",
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(deps.db.issueGatewayTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-from-header",
        assignedGatewayId: "gateway-1",
      }),
    );
  });

  it("gateway ticket 발급은 인증 actor가 없으면 거부한다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps();

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: "/api/realtime-chat",
      },
      deps,
    );

    const response = await http.findRoute("POST", "/api/realtime-chat/gateway-tickets").handler(
      httpRequest({
        body: {},
      }),
    );

    expect(response).toEqual({
      status: 401,
      body: {
        reason: "UNAUTHENTICATED",
        message: "authenticated actor is required",
      },
    });
    expect(deps.db.issueGatewayTicket).not.toHaveBeenCalled();
  });

  it("gateway ticket consume endpoint는 raw ticket과 gatewayId를 db port에 전달한다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps();

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: "/api/realtime-chat",
      },
      deps,
    );

    const response = await http
      .findRoute("POST", "/api/realtime-chat/internal/gateway-tickets/consume")
      .handler(
        httpRequest({
          body: {
            ticket: " raw-ticket ",
            gatewayId: " gateway-1 ",
          },
        }),
      );

    expect(response).toEqual({
      status: 200,
      body: {
        status: "consumed",
        ticket: {
          actorId: "user-1",
          consumedAt: fixedNow.toISOString(),
        },
      },
    });
    expect(deps.db.consumeGatewayTicket).toHaveBeenCalledWith({
      ticketValueHash: "hash:raw-ticket",
      gatewayId: "gateway-1",
      consumedAt: fixedNow.toISOString(),
    });
  });

  it("channel message 저장 후 outbound publish 실패가 accepted response를 막지 않는다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps({
      outboundEventBus: {
        publish: vi.fn(async () => {
          throw new Error("bus down");
        }),
      },
    });

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: "/api/realtime-chat",
      },
      deps,
    );

    const request: SendChannelMessageRequest = {
      requestId: "command-1",
      actorId: "user-1",
      workspaceId: "workspace-1",
      channelId: "channel-1",
      clientMessageId: "client-message-1",
      content: {
        kind: "text",
        text: "안녕하세요",
      },
      sentAtClient: fixedNow.toISOString(),
    };
    const response = await http
      .findRoute("POST", "/api/realtime-chat/internal/messages/channel")
      .handler(
        httpRequest({
          body: request,
        }),
      );

    expect(response).toEqual({
      status: 200,
      body: {
        status: "accepted",
        commandId: "command-1",
        clientMessageId: "client-message-1",
        messageId: "message-1",
        streamId: "stream-channel-channel-1",
        streamType: "CHANNEL",
        sequence: 10,
        serverCreatedAt: fixedNow.toISOString(),
      },
    });
    expect(deps.permissionPort.canWriteMessage).toHaveBeenCalledWith({
      actorId: "user-1",
      target: {
        kind: "channel",
        workspaceId: "workspace-1",
        channelId: "channel-1",
      },
    });
    expect(deps.outboundEventBus.publish).toHaveBeenCalledTimes(1);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "failed to publish realtime chat outbound delivery event",
      expect.objectContaining({
        streamId: "stream-channel-channel-1",
        messageId: "message-1",
      }),
    );
  });

  it("stream sync는 query limit을 syncMaxLimit으로 clamp해서 db port에 전달한다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps();

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: "/api/realtime-chat",
        syncDefaultLimit: 50,
        syncMaxLimit: 100,
      },
      deps,
    );

    const response = await http
      .findRoute("GET", "/api/realtime-chat/streams/:streamId/messages")
      .handler(
        httpRequest({
          params: {
            streamId: "stream-channel-1",
          },
          query: {
            requestId: "command-1",
            actorId: "user-1",
            afterSequence: "184",
            limit: "500",
          },
        }),
      );

    expect(response).toEqual({
      status: 200,
      body: {
        streamId: "stream-channel-1",
        messages: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      },
    });
    expect(deps.db.listMessages).toHaveBeenCalledWith({
      streamId: "stream-channel-1",
      afterSequence: 184,
      limit: 100,
    });
  });

  it("read cursor port가 advanced false를 반환하면 unchanged response로 노출한다", async () => {
    const http = createHttpServerDouble();
    const deps = createApiRuntimeDeps({
      db: {
        markReadCursor: vi.fn(async (input) => ({
          actorId: input.actorId,
          streamId: input.streamId,
          lastReadSequence: 120,
          updatedAt: input.updatedAt,
          advanced: false,
        })),
      },
    });

    await mountRealtimeChatApi(
      http.server,
      {
        basePath: "/api/realtime-chat",
      },
      deps,
    );

    const request: MarkReadCursorRequest = {
      requestId: "command-1",
      actorId: "user-1",
      streamId: "stream-channel-1",
      lastReadSequence: 100,
    };
    const response = await http
      .findRoute("POST", "/api/realtime-chat/internal/read-cursors")
      .handler(
        httpRequest({
          body: request,
        }),
      );

    expect(response).toEqual({
      status: 200,
      body: {
        status: "unchanged",
        commandId: "command-1",
        streamId: "stream-channel-1",
        lastReadSequence: 120,
        updatedAt: fixedNow.toISOString(),
      },
    });
  });
});
