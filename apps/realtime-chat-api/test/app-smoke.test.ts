import { describe, expect, it, vi } from "vitest";

import { createRealtimeChatApiApp } from "../src/app.js";

import type { RealtimeChatApiAppDeps } from "../src/app.js";

describe("realtime chat api app", () => {
  it("adds request ID, security headers, and structured access logging", async () => {
    const logger = createLogger();
    const app = createRealtimeChatApiApp(createDeps({ logger }));

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/health",
        requestId: response.headers.get("x-request-id"),
        status: 200,
      }),
      "realtime chat api request completed",
    );
  });

  it("reports readiness failures without changing liveness", async () => {
    const app = createRealtimeChatApiApp(
      createDeps({
        checkReadiness: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
      }),
    );

    const [liveness, readiness] = await Promise.all([
      app.request("/health/live"),
      app.request("/health/ready"),
    ]);

    expect(liveness.status).toBe(200);
    expect(readiness.status).toBe(503);
    await expect(readiness.json()).resolves.toEqual({ status: "not_ready" });
  });

  it("rejects oversized request bodies", async () => {
    const issue = vi.fn();
    const app = createRealtimeChatApiApp(createDeps({ issue }), {
      requestBodyLimitBytes: 16,
    });

    const response = await app.request("/realtime-chat/gateway-tickets", {
      body: JSON.stringify({ actorId: "a".repeat(32) }),
      headers: {
        "content-type": "application/json",
        "x-actor-id": "authenticated-actor",
      },
      method: "POST",
    });

    expect(response.status).toBe(413);
    expect(issue).not.toHaveBeenCalled();
  });

  it("times out slow handlers", async () => {
    const app = createRealtimeChatApiApp(
      createDeps({
        issue: vi.fn(() => new Promise<never>(() => {})),
      }),
      {
        handlerTimeoutMilliseconds: 5,
      },
    );

    const response = await app.request("/realtime-chat/gateway-tickets", {
      headers: {
        "x-actor-id": "authenticated-actor",
      },
      method: "POST",
    });

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: "gateway_ticket_unavailable",
      status: "error",
    });
  });

  it("allows only configured browser origins", async () => {
    const app = createRealtimeChatApiApp(createDeps(), {
      corsOrigins: ["https://web.example.com"],
    });

    const response = await app.request("/realtime-chat/gateway-tickets", {
      headers: {
        origin: "https://web.example.com",
        "x-actor-id": "authenticated-actor",
      },
      method: "POST",
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("https://web.example.com");
  });

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
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
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
    checkReadiness: overrides.checkReadiness ?? vi.fn(),
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
  };
}

function createLogger(): RealtimeChatApiAppDeps["logger"] {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}
