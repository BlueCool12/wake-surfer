import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import type { RealtimeChatGatewayRuntimeHandle } from '../src/runtime/create-runtime-deps';

describe('realtime-chat-gateway app smoke', () => {
  it('health와 readiness endpoint를 제공한다', async () => {
    const app = await createApp(testEnv(), async () => fakeRuntime());

    await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      const port = portOf(app.address());

      await expect(expectJson(`http://127.0.0.1:${port}/healthz`)).resolves.toEqual({
        status: 200,
        body: {
          status: 'ok',
          service: '@wake-surfer/realtime-chat-gateway'
        }
      });
      await expect(expectJson(`http://127.0.0.1:${port}/readyz`)).resolves.toEqual({
        status: 200,
        body: {
          status: 'ready',
          database: 'configured'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('mounted WebSocket path에서 gateway.connected를 보낸다', async () => {
    const app = await createApp(testEnv(), async () => fakeRuntime());

    await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      const port = portOf(app.address());
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/ws/realtime-chat?ticket=test-ticket`
      );
      const event = await nextJsonMessage(socket);

      expect(event).toEqual({
        type: 'gateway.connected',
        sessionId: expect.stringMatching(/^gateway-session_/),
        gatewayId: 'test-gateway',
        connectedAt: expect.any(String)
      });

      socket.close();
    } finally {
      await app.close();
    }
  });
});

async function expectJson(
  url: string
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url);

  return {
    status: response.status,
    body: await response.json()
  };
}

function nextJsonMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
    socket.once('error', reject);
  });
}

function portOf(address: AddressInfo | string | null): number {
  if (!address || typeof address === 'string') {
    throw new Error('test server address is not available');
  }

  return address.port;
}

function fakeRuntime(): RealtimeChatGatewayRuntimeHandle {
  return {
    deps: {
      chatApiClient: {
        issueGatewayTicket: async () => ({
          ticket: 'test-ticket',
          expiresAt: new Date().toISOString()
        }),
        sendChannelMessage: async () => {
          throw new Error('not used');
        },
        sendDMMessage: async () => {
          throw new Error('not used');
        },
        replyThreadMessage: async () => {
          throw new Error('not used');
        },
        markReadCursor: async () => {
          throw new Error('not used');
        },
        syncStreamMessages: async () => {
          throw new Error('not used');
        }
      },
      gatewayTicketPort: {
        consume: async () => ({
          status: 'consumed',
          ticket: {
            actorId: 'user-1',
            workspaceId: 'workspace-1',
            consumedAt: new Date().toISOString()
          }
        })
      },
      outboundEventBus: {
        subscribe: () => ({
          unsubscribe() {}
        })
      },
      clock: {
        now: () => new Date()
      },
      idGenerator: {
        generateId: (scope) => `${scope}_test`
      },
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    },
    close: async () => {}
  };
}

function testEnv(): ReturnType<typeof loadEnv> {
  return loadEnv({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3002',
    LOG_LEVEL: 'silent',
    REALTIME_CHAT_GATEWAY_PATH: '/ws/realtime-chat',
    GATEWAY_ID: 'test-gateway',
    REALTIME_CHAT_API_BASE_URL: 'http://127.0.0.1:3001/api/realtime-chat',
    MAX_PAYLOAD_BYTES: '65536',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REALTIME_CHAT_OUTBOUND_CHANNEL: 'realtime-chat:test:outbound'
  });
}
