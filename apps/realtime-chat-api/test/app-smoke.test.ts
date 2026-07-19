import { once } from "node:events";

import { serve } from "@hono/node-server";
import { describe, expect, it, vi } from "vitest";

import { createRealtimeChatApiApp } from "../src/app.js";

import type { RealtimeChatApiAppDeps } from "../src/app.js";

describe("realtime chat api app", () => {
  it("issues a gateway ticket from authenticated actor context", async () => {
    const issue = vi.fn(async () => ({
      expiresAt: "2026-07-09T00:01:00.000Z",
      gatewayUrl: "ws://localhost:3001/realtime-chat",
      ticket: "ticket-1",
    }));
    const app = createRealtimeChatApiApp(
      createDeps({
        issue,
      }),
    );

    const response = await app.request("/realtime-chat/gateway-tickets", {
      headers: {
        "x-actor-id": "authenticated-actor",
      },
      method: "POST",
    });

    await expect(response.json()).resolves.toEqual({
      expiresAt: "2026-07-09T00:01:00.000Z",
      gatewayUrl: "ws://localhost:3001/realtime-chat",
      ticket: "ticket-1",
    });
    expect(response.status).toBe(201);
    expect(issue).toHaveBeenCalledWith({
      actorId: "authenticated-actor",
    });
  });

  it("issues a gateway ticket without a body through the Node server adapter", async () => {
    const issue = vi.fn(async () => ({
      expiresAt: "2026-07-09T00:01:00.000Z",
      gatewayUrl: "ws://localhost:3001/realtime-chat",
      ticket: "ticket-1",
    }));
    const app = createRealtimeChatApiApp(
      createDeps({
        issue,
      }),
    );
    const server = serve({
      fetch: app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      await once(server, "listening");
      const address = server.address();

      if (address === null || typeof address === "string") {
        throw new Error("realtime chat API test server did not expose a TCP port");
      }

      const response = await fetch(
        `http://127.0.0.1:${address.port}/realtime-chat/gateway-tickets`,
        {
          headers: {
            "x-actor-id": "authenticated-actor",
          },
          method: "POST",
        },
      );

      expect(response.status).toBe(201);
      expect(issue).toHaveBeenCalledWith({
        actorId: "authenticated-actor",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });

  it("rejects issue bodies with client-owned actor fields", async () => {
    const issue = vi.fn();
    const app = createRealtimeChatApiApp(
      createDeps({
        issue,
      }),
    );

    const response = await app.request("/realtime-chat/gateway-tickets", {
      body: JSON.stringify({
        actorId: "body-actor",
        workspaceId: "body-workspace",
      }),
      headers: {
        "content-type": "application/json",
        "x-actor-id": "authenticated-actor",
      },
      method: "POST",
    });

    await expect(response.json()).resolves.toMatchObject({
      code: "bad_request",
      status: "error",
    });
    expect(response.status).toBe(400);
    expect(issue).not.toHaveBeenCalled();
  });

  it("consumes a gateway ticket with gateway context outside the body", async () => {
    const consume = vi.fn(async () => ({
      status: "consumed" as const,
      ticket: {
        actorId: "actor-1",
        consumedAt: "2026-07-09T00:00:10.000Z",
      },
    }));
    const app = createRealtimeChatApiApp(
      createDeps({
        consume,
      }),
    );

    const response = await app.request("/internal/realtime-chat/gateway-tickets/consume", {
      body: JSON.stringify({
        ticket: "ticket-1",
      }),
      headers: {
        "content-type": "application/json",
        "x-gateway-id": "gateway-1",
      },
      method: "POST",
    });

    await expect(response.json()).resolves.toEqual({
      status: "consumed",
      ticket: {
        actorId: "actor-1",
        consumedAt: "2026-07-09T00:00:10.000Z",
      },
    });
    expect(response.status).toBe(200);
    expect(consume).toHaveBeenCalledWith(
      {
        ticket: "ticket-1",
      },
      {
        gatewayId: "gateway-1",
      },
    );
  });

  it("rejects consume bodies that include gatewayId", async () => {
    const consume = vi.fn();
    const app = createRealtimeChatApiApp(
      createDeps({
        consume,
      }),
    );

    const response = await app.request("/internal/realtime-chat/gateway-tickets/consume", {
      body: JSON.stringify({
        gatewayId: "gateway-1",
        ticket: "ticket-1",
      }),
      headers: {
        "content-type": "application/json",
        "x-gateway-id": "gateway-1",
      },
      method: "POST",
    });

    await expect(response.json()).resolves.toMatchObject({
      code: "bad_request",
      status: "error",
    });
    expect(response.status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
  });

  it("maps domain ticket rejection to a successful rejected result", async () => {
    const app = createRealtimeChatApiApp(
      createDeps({
        consume: vi.fn(async () => ({
          reason: "invalid_or_expired" as const,
          status: "rejected" as const,
        })),
      }),
    );

    const response = await app.request("/internal/realtime-chat/gateway-tickets/consume", {
      body: JSON.stringify({
        ticket: "ticket-1",
      }),
      headers: {
        "content-type": "application/json",
        "x-gateway-id": "gateway-1",
      },
      method: "POST",
    });

    await expect(response.json()).resolves.toEqual({
      reason: "invalid_or_expired",
      status: "rejected",
    });
    expect(response.status).toBe(200);
  });

  it("maps infrastructure failures to 5xx and logs them", async () => {
    const logger = createLogger();
    const app = createRealtimeChatApiApp(
      createDeps({
        issue: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
        logger,
      }),
    );

    const response = await app.request("/realtime-chat/gateway-tickets", {
      headers: {
        "x-actor-id": "authenticated-actor",
      },
      method: "POST",
    });

    await expect(response.json()).resolves.toMatchObject({
      code: "gateway_ticket_unavailable",
      status: "error",
    });
    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalled();
  });

  it("mounts each app-owned Stream Messages route only when its usecase is provided", async () => {
    const streamResponse = {
      streamId: "channel:channel-api",
      throughSequence: 0,
      messages: [],
      nextBeforeSequence: null,
      hasMoreBefore: false,
    };
    const loadLatest = vi.fn(async () => streamResponse);
    const enabled = createRealtimeChatApiApp(
      createDeps({
        loadLatestMessages: loadLatest,
      }),
    );
    const disabled = createRealtimeChatApiApp(createDeps());

    const enabledResponse = await enabled.request(
      "/realtime-chat/channels/channel-api/messages/latest",
      {
        headers: {
          "x-actor-id": "actor-api",
          "x-request-id": "request-api-stream",
        },
      },
    );
    const disabledResponse = await disabled.request(
      "/realtime-chat/channels/channel-api/messages/latest",
      { headers: { "x-actor-id": "actor-api" } },
    );
    const unprovidedOlderResponse = await enabled.request(
      "/realtime-chat/channels/channel-api/messages/older?beforeSequence=1",
      { headers: { "x-actor-id": "actor-api" } },
    );

    expect(enabledResponse.status).toBe(200);
    expect(enabledResponse.headers.get("x-request-id")).toBe("request-api-stream");
    expect(loadLatest).toHaveBeenCalled();
    expect(disabledResponse.status).toBe(404);
    expect(unprovidedOlderResponse.status).toBe(404);
  });

  it("maps feature-neutral boundary failures to internal_error", async () => {
    const app = createRealtimeChatApiApp(
      createDeps({
        authenticateActor: () => {
          throw new Error("auth provider unavailable");
        },
      }),
    );

    const response = await app.request("/realtime-chat/gateway-tickets", {
      method: "POST",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "internal_error",
      status: "error",
    });
  });

  it("allows browser GET preflight only for configured origins", async () => {
    const app = createRealtimeChatApiApp(
      createDeps({
        cors: {
          allowedHeaders: ["content-type", "x-actor-id", "x-request-id"],
          allowedOrigins: ["https://web.example.test"],
        },
      }),
    );

    const allowed = await app.request("/realtime-chat/channels/channel-api/messages/latest", {
      headers: {
        origin: "https://web.example.test",
        "access-control-request-method": "GET",
      },
      method: "OPTIONS",
    });
    const denied = await app.request("/realtime-chat/channels/channel-api/messages/latest", {
      headers: {
        origin: "https://attacker.example.test",
        "access-control-request-method": "GET",
      },
      method: "OPTIONS",
    });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://web.example.test");
    expect(allowed.headers.get("access-control-allow-methods")).toContain("GET");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps ticket and Stream Messages timeout codes feature-specific", async () => {
    const delayed = () => new Promise<never>(() => undefined);
    const ticketApp = createRealtimeChatApiApp(
      createDeps({
        issue: vi.fn(delayed),
        requestTimeoutMilliseconds: 5,
      }),
    );
    const streamApp = createRealtimeChatApiApp(
      createDeps({
        loadLatestMessages: vi.fn(delayed),
        loadOlderMessages: vi.fn(delayed),
        requestTimeoutMilliseconds: 5,
      }),
    );

    const [ticket, stream] = await Promise.all([
      ticketApp.request("/realtime-chat/gateway-tickets", {
        headers: { "x-actor-id": "actor-timeout" },
        method: "POST",
      }),
      streamApp.request("/realtime-chat/channels/channel-timeout/messages/latest", {
        headers: { "x-actor-id": "actor-timeout" },
      }),
    ]);

    await expect(ticket.json()).resolves.toMatchObject({
      code: "gateway_ticket_unavailable",
    });
    await expect(stream.json()).resolves.toMatchObject({
      code: "stream_messages_unavailable",
      retryable: true,
    });
  });
});

function createDeps(
  overrides: Partial<RealtimeChatApiAppDeps> & {
    consume?: RealtimeChatApiAppDeps["gatewayTicket"]["consume"];
    issue?: RealtimeChatApiAppDeps["gatewayTicket"]["issue"];
  } = {},
): RealtimeChatApiAppDeps {
  return {
    authenticateActor:
      overrides.authenticateActor ??
      ((request) => ({
        actorId: request.headers.get("x-actor-id") ?? "",
      })),
    authenticateGateway:
      overrides.authenticateGateway ??
      ((request) => ({
        gatewayId: request.headers.get("x-gateway-id") ?? "",
      })),
    ...(overrides.cors === undefined ? {} : { cors: overrides.cors }),
    gatewayTicket: overrides.gatewayTicket ?? {
      consume:
        overrides.consume ??
        vi.fn(async () => ({
          status: "consumed" as const,
          ticket: {
            actorId: "actor-1",
            consumedAt: "2026-07-09T00:00:00.000Z",
          },
        })),
      issue:
        overrides.issue ??
        vi.fn(async () => ({
          expiresAt: "2026-07-09T00:01:00.000Z",
          gatewayUrl: "ws://localhost:3001/realtime-chat",
          ticket: "ticket-1",
        })),
    },
    logger: overrides.logger ?? createLogger(),
    ...(overrides.requestTimeoutMilliseconds === undefined
      ? {}
      : { requestTimeoutMilliseconds: overrides.requestTimeoutMilliseconds }),
    ...(overrides.getAssertedActor === undefined
      ? {}
      : { getAssertedActor: overrides.getAssertedActor }),
    ...(overrides.loadLatestMessages === undefined
      ? {}
      : { loadLatestMessages: overrides.loadLatestMessages }),
    ...(overrides.loadOlderMessages === undefined
      ? {}
      : { loadOlderMessages: overrides.loadOlderMessages }),
    ...(overrides.syncAfterMessages === undefined
      ? {}
      : { syncAfterMessages: overrides.syncAfterMessages }),
  };
}

function createLogger(): RealtimeChatApiAppDeps["logger"] {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}
