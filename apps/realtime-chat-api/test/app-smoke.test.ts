import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import type { RealtimeChatApiRuntimeHandle } from '../src/runtime/create-runtime-deps';
import { createInMemoryRealtimeChatDb } from '../src/runtime/in-memory-realtime-chat-db';
import { createNodeIdGenerator } from '../src/runtime/id-generator';
import { createNoopMetrics } from '../src/runtime/metrics';
import { createAllowAllPermissionPort } from '../src/runtime/permission-port';
import { createNodeGatewayTicketHasher } from '../src/runtime/ticket-hasher';

describe('realtime-chat-api app smoke', () => {
  it('health와 readiness endpoint를 제공한다', async () => {
    const { app, close } = await createApp(testEnv(), async () => fakeRuntime());

    try {
      await expect(expectJson(app.request('/healthz'))).resolves.toEqual({
        status: 200,
        body: {
          status: 'ok',
          service: '@wake-surfer/realtime-chat-api'
        }
      });
      await expect(expectJson(app.request('/readyz'))).resolves.toEqual({
        status: 200,
        body: {
          status: 'ready',
          database: 'in-memory'
        }
      });
    } finally {
      await close();
    }
  });

  it('mounted realtime chat API route로 gateway ticket을 발급한다', async () => {
    const { app, close } = await createApp(
      testEnv({
        REALTIME_CHAT_GATEWAY_URL: 'wss://example.test/ws/realtime-chat'
      }),
      async () => fakeRuntime()
    );

    try {
      const response = await app.request('/api/realtime-chat/gateway-tickets', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          actorId: 'user-1',
          workspaceId: 'workspace-1'
        })
      });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body).toEqual({
        ticket: expect.any(String),
        gatewayUrl: 'wss://example.test/ws/realtime-chat',
        expiresAt: expect.any(String)
      });
    } finally {
      await close();
    }
  });
});

async function expectJson(
  responsePromise: Promise<Response> | Response
): Promise<{ status: number; body: unknown }> {
  const response = await responsePromise;

  return {
    status: response.status,
    body: await response.json()
  };
}

function testEnv(
  overrides: Record<string, string> = {}
): ReturnType<typeof loadEnv> {
  return loadEnv({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3001',
    LOG_LEVEL: 'silent',
    REALTIME_CHAT_BASE_PATH: '/api/realtime-chat',
    GATEWAY_TICKET_TTL_SECONDS: '60',
    MAX_MESSAGE_TEXT_LENGTH: '4000',
    SYNC_DEFAULT_LIMIT: '50',
    SYNC_MAX_LIMIT: '100',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REALTIME_CHAT_OUTBOUND_CHANNEL: 'realtime-chat:test:outbound',
    ...overrides
  });
}

function fakeRuntime(): RealtimeChatApiRuntimeHandle {
  const db = createInMemoryRealtimeChatDb();

  return {
    deps: {
      db,
      permissionPort: createAllowAllPermissionPort(),
      outboundEventBus: {
        publish: async () => {}
      },
      clock: {
        now: () => new Date()
      },
      idGenerator: createNodeIdGenerator(),
      logger: {
        info() {},
        warn() {},
        error() {}
      },
      metrics: createNoopMetrics(),
      ticketHasher: createNodeGatewayTicketHasher()
    },
    close: async () => {}
  };
}
