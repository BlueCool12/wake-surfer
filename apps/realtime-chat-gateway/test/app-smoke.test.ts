import type { AddressInfo } from "node:net";

import { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";

import { createRealtimeChatGatewayApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

import type { RealtimeChatGatewayAppDeps } from "../src/app.js";

describe("실시간 채팅 게이트웨이 앱", () => {
  it("헬스 체크를 제공한다", async () => {
    const app = createRealtimeChatGatewayApp(testConfig(), createDeps());

    await app.listen({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${portOf(app.address())}/health`);

      await expect(response.json()).resolves.toEqual({
        status: "ok",
      });
      expect(response.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("게이트웨이 티켓을 소비하고 수락한 소켓을 로컬 세션으로 유지한다", async () => {
    const consumeGatewayTicket = vi.fn(async () => ({
      status: "consumed" as const,
      ticket: {
        actorId: "actor-1",
        consumedAt: "2026-07-09T00:00:10.000Z",
      },
    }));
    const app = createRealtimeChatGatewayApp(
      testConfig(),
      createDeps({
        gatewayTicketConsumer: {
          consumeGatewayTicket,
        },
      }),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=t1`);

    try {
      await nextOpen(socket);
      await waitFor(() => expect(app.sessionCount()).toBe(1));
      expect(consumeGatewayTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayId: "gateway-1",
          requestId: expect.stringMatching(/^gateway-request_/),
          signal: expect.any(AbortSignal),
          ticket: "t1",
        }),
      );
    } finally {
      socket.close();
      await app.close();
    }
  });

  it("게이트웨이 티켓이 없는 소켓을 닫는다", async () => {
    const consumeGatewayTicket = vi.fn();
    const app = createRealtimeChatGatewayApp(
      testConfig(),
      createDeps({
        gatewayTicketConsumer: {
          consumeGatewayTicket,
        },
      }),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`ws://127.0.0.1:${portOf(app.address())}/realtime-chat`);

    try {
      await expect(nextClose(socket)).resolves.toMatchObject({
        code: 4401,
      });
      expect(consumeGatewayTicket).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("API가 게이트웨이 티켓을 거절하면 소켓을 닫는다", async () => {
    const app = createRealtimeChatGatewayApp(
      testConfig(),
      createDeps({
        gatewayTicketConsumer: {
          consumeGatewayTicket: vi.fn(async () => ({
            reason: "invalid_or_expired" as const,
            status: "rejected" as const,
          })),
        },
      }),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=t1`);

    try {
      await expect(nextClose(socket)).resolves.toMatchObject({
        code: 4401,
        reason: "invalid_or_expired",
      });
    } finally {
      await app.close();
    }
  });

  it("예상하지 못한 인증 처리 예외를 기록하고 소켓을 안전하게 닫는다", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const app = createRealtimeChatGatewayApp(
      testConfig(),
      createDeps({
        gatewayTicketConsumer: {
          consumeGatewayTicket: vi.fn(async () => undefined as never),
        },
        logger,
      }),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=t1`);

    try {
      await expect(nextClose(socket)).resolves.toMatchObject({ code: 1011 });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Object),
          requestId: expect.stringMatching(/^gateway-request_/),
        }),
        "실시간 채팅 게이트웨이 연결 인증 처리 실패",
      );
    } finally {
      await app.close();
    }
  });

  it("허용되지 않은 Origin의 upgrade를 거절한다", async () => {
    const app = createRealtimeChatGatewayApp(
      testConfig({ allowedOrigins: ["https://web.example.com"] }),
      createDeps(),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(
      `ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=t1`,
      {
        origin: "https://evil.example.com",
      },
    );

    try {
      await expect(nextUnexpectedResponse(socket)).resolves.toBe(403);
    } finally {
      socket.terminate();
      await app.close();
    }
  });

  it("티켓 인증 시간이 초과되면 연결을 닫는다", async () => {
    const app = createRealtimeChatGatewayApp(
      testConfig({ apiRequestTimeoutMilliseconds: 5 }),
      createDeps({
        gatewayTicketConsumer: {
          consumeGatewayTicket: vi.fn(() => new Promise<never>(() => {})),
        },
      }),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=t1`);

    try {
      await expect(nextClose(socket)).resolves.toMatchObject({ code: 1011 });
      expect(app.pendingAuthenticationCount()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("인증 대기 연결 상한을 넘으면 새 연결을 거절한다", async () => {
    const app = createRealtimeChatGatewayApp(
      testConfig({
        apiRequestTimeoutMilliseconds: 1_000,
        maxPendingAuthentications: 1,
        shutdownGraceMilliseconds: 50,
      }),
      createDeps({
        gatewayTicketConsumer: {
          consumeGatewayTicket: vi.fn(() => new Promise<never>(() => {})),
        },
      }),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });

    const first = new WebSocket(
      `ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=first`,
    );
    await nextOpen(first);
    await waitFor(() => expect(app.pendingAuthenticationCount()).toBe(1));

    const second = new WebSocket(
      `ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=second`,
    );

    try {
      await expect(nextClose(second)).resolves.toMatchObject({ code: 1013 });
    } finally {
      first.close();
      await app.close();
    }
  });

  it("전체 연결 상한을 넘으면 upgrade를 거절한다", async () => {
    const app = createRealtimeChatGatewayApp(testConfig({ maxConnections: 1 }), createDeps());

    await app.listen({ host: "127.0.0.1", port: 0 });

    const first = new WebSocket(
      `ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=first`,
    );
    await nextOpen(first);

    const second = new WebSocket(
      `ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=second`,
    );

    try {
      await expect(nextUnexpectedResponse(second)).resolves.toBe(503);
    } finally {
      second.terminate();
      first.close();
      await app.close();
    }
  });

  it("heartbeat에 응답하지 않는 연결을 정리한다", async () => {
    const app = createRealtimeChatGatewayApp(
      testConfig({ heartbeatIntervalMilliseconds: 10 }),
      createDeps(),
    );

    await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`ws://127.0.0.1:${portOf(app.address())}/realtime-chat?ticket=t1`);

    try {
      await nextOpen(socket);
      await waitFor(() => expect(app.sessionCount()).toBe(1));
      const closed = nextClose(socket);
      socket.pause();

      await waitFor(() => expect(app.sessionCount()).toBe(0));
      socket.resume();
      await expect(closed).resolves.toMatchObject({ code: 1006 });
    } finally {
      socket.terminate();
      await app.close();
    }
  });
});

function createDeps(
  overrides: Partial<RealtimeChatGatewayAppDeps> = {},
): RealtimeChatGatewayAppDeps {
  return {
    gatewayTicketConsumer: overrides.gatewayTicketConsumer ?? {
      consumeGatewayTicket: vi.fn(async () => ({
        status: "consumed" as const,
        ticket: {
          actorId: "actor-1",
          consumedAt: "2026-07-09T00:00:10.000Z",
        },
      })),
    },
    logger: overrides.logger ?? {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
}

function testConfig(
  overrides: Partial<ReturnType<typeof loadEnv>> = {},
): ReturnType<typeof loadEnv> {
  return {
    ...loadEnv({
      HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
      PORT: "3001",
      REALTIME_CHAT_API_BASE_URL: "http://127.0.0.1:3000",
      REALTIME_CHAT_API_GATEWAY_ID_HEADER: "x-gateway-id",
      REALTIME_CHAT_GATEWAY_ID: "gateway-1",
      REALTIME_CHAT_GATEWAY_MAX_PAYLOAD_BYTES: "65536",
      REALTIME_CHAT_GATEWAY_PATH: "/realtime-chat",
      REALTIME_CHAT_GATEWAY_TICKET_HEADER: "x-gateway-ticket",
    }),
    ...overrides,
  };
}

function nextOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) =>
      resolve({
        code,
        reason: reason.toString(),
      }),
    );
    socket.once("error", reject);
  });
}

function nextUnexpectedResponse(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("error", reject);
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 1_000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

function portOf(address: AddressInfo | string | null): number {
  if (!address || typeof address === "string") {
    throw new Error("테스트 서버 주소를 사용할 수 없습니다");
  }

  return address.port;
}
