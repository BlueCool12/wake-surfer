import { vi } from 'vitest';
import type {
  HttpRouteDefinition,
  HttpServerLike,
  RealtimeChatApiRuntimeDeps,
  RealtimeChatGatewayRuntimeDeps,
  WebSocketConnectionLike,
  WebSocketMessagePayload,
  WebSocketRouteDefinition,
  WebSocketServerLike
} from '@wake-surfer/realtime-chat';
import type {
  MarkReadCursorResponse,
  MessageCommandResponse,
  OutboundMessageDeliveryRequested,
  PublicMessageDto,
  RealtimeChatErrorCode,
  SyncStreamMessagesResponse
} from '@wake-surfer/realtime-chat-contracts';

export const fixedNow = new Date('2026-01-01T00:00:00.000Z');

export function createHttpServerDouble(): {
  server: HttpServerLike;
  routes: HttpRouteDefinition[];
  findRoute: (method: HttpRouteDefinition['method'], path: string) => HttpRouteDefinition;
} {
  const routes: HttpRouteDefinition[] = [];
  const server: HttpServerLike = {
    route: vi.fn(async (definition) => {
      routes.push(definition);
    })
  };

  return {
    server,
    routes,
    findRoute(method, path) {
      const route = routes.find(
        (candidate) => candidate.method === method && candidate.path === path
      );

      if (!route) {
        throw new Error(`route not found: ${method} ${path}`);
      }

      return route;
    }
  };
}

type ApiRuntimeDepsOverrides = {
  db?: Partial<RealtimeChatApiRuntimeDeps['db']>;
  permissionPort?: Partial<RealtimeChatApiRuntimeDeps['permissionPort']>;
  outboundEventBus?: Partial<RealtimeChatApiRuntimeDeps['outboundEventBus']>;
  clock?: Partial<RealtimeChatApiRuntimeDeps['clock']>;
  idGenerator?: Partial<RealtimeChatApiRuntimeDeps['idGenerator']>;
  logger?: Partial<RealtimeChatApiRuntimeDeps['logger']>;
  metrics?: RealtimeChatApiRuntimeDeps['metrics'];
  ticketHasher?: RealtimeChatApiRuntimeDeps['ticketHasher'];
};

export function createApiRuntimeDeps(
  overrides: ApiRuntimeDepsOverrides = {}
): RealtimeChatApiRuntimeDeps {
  let idSequence = 0;
  const defaultMetrics: NonNullable<RealtimeChatApiRuntimeDeps['metrics']> = {
    increment: vi.fn()
  };
  const defaultTicketHasher: NonNullable<
    RealtimeChatApiRuntimeDeps['ticketHasher']
  > = {
    hash: vi.fn(async (ticketValue) => `hash:${ticketValue}`)
  };

  const deps: RealtimeChatApiRuntimeDeps = {
    db: {
      issueGatewayTicket: vi.fn(async () => undefined),
      findMessageByIdempotencyKey: vi.fn(async () => undefined),
      appendMessage: vi.fn(async (input) => ({
        messageId: input.messageId,
        streamId: streamIdForTarget(input.target),
        streamType: input.streamType,
        sequence: 10,
        ...(input.senderId ? { senderId: input.senderId } : {}),
        messageType: input.messageType,
        content: input.content,
        createdAt: input.createdAt,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      })),
      markReadCursor: vi.fn(async (input) => ({
        actorId: input.actorId,
        streamId: input.streamId,
        lastReadSequence: input.lastReadSequence,
        updatedAt: input.updatedAt,
        advanced: true
      })),
      listMessages: vi.fn(async () => ({
        messages: [],
        hasMoreBefore: false,
        hasMoreAfter: false
      }))
    },
    permissionPort: {
      canIssueGatewayTicket: vi.fn(async () => ({ allowed: true as const })),
      canWriteMessage: vi.fn(async () => ({ allowed: true as const })),
      canReadStream: vi.fn(async () => ({ allowed: true as const })),
      resolveMessageRecipients: vi.fn(async () => ['user-recipient'])
    },
    outboundEventBus: {
      publish: vi.fn(async () => undefined)
    },
    clock: {
      now: vi.fn(() => fixedNow)
    },
    idGenerator: {
      generateId: vi.fn((scope) => `${scope}-${++idSequence}`)
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    metrics: defaultMetrics,
    ticketHasher: defaultTicketHasher
  };

  return {
    db: {
      ...deps.db,
      ...overrides.db
    },
    permissionPort: {
      ...deps.permissionPort,
      ...overrides.permissionPort
    },
    outboundEventBus: {
      ...deps.outboundEventBus,
      ...overrides.outboundEventBus
    },
    clock: {
      ...deps.clock,
      ...overrides.clock
    },
    idGenerator: {
      ...deps.idGenerator,
      ...overrides.idGenerator
    },
    logger: {
      ...deps.logger,
      ...overrides.logger
    },
    metrics: overrides.metrics ?? defaultMetrics,
    ticketHasher: overrides.ticketHasher ?? defaultTicketHasher
  };
}

export function createWebSocketServerDouble(): {
  server: WebSocketServerLike;
  routes: WebSocketRouteDefinition[];
  findRoute: (path: string) => WebSocketRouteDefinition;
} {
  const routes: WebSocketRouteDefinition[] = [];
  const server: WebSocketServerLike = {
    route: vi.fn(async (definition) => {
      routes.push(definition);
    })
  };

  return {
    server,
    routes,
    findRoute(path) {
      const route = routes.find((candidate) => candidate.path === path);

      if (!route) {
        throw new Error(`websocket route not found: ${path}`);
      }

      return route;
    }
  };
}

type GatewayRuntimeDepsOverrides = {
  chatApiClient?: Partial<RealtimeChatGatewayRuntimeDeps['chatApiClient']>;
  gatewayTicketPort?: Partial<RealtimeChatGatewayRuntimeDeps['gatewayTicketPort']>;
  outboundEventBus?: Partial<RealtimeChatGatewayRuntimeDeps['outboundEventBus']>;
  clock?: Partial<RealtimeChatGatewayRuntimeDeps['clock']>;
  idGenerator?: Partial<RealtimeChatGatewayRuntimeDeps['idGenerator']>;
  logger?: Partial<RealtimeChatGatewayRuntimeDeps['logger']>;
  metrics?: RealtimeChatGatewayRuntimeDeps['metrics'];
};

export function createGatewayRuntimeDeps(
  overrides: GatewayRuntimeDepsOverrides = {}
): {
  deps: RealtimeChatGatewayRuntimeDeps;
  outboundHandlers: Array<
    (event: OutboundMessageDeliveryRequested) => void | Promise<void>
  >;
} {
  let idSequence = 0;
  const outboundHandlers: Array<
    (event: OutboundMessageDeliveryRequested) => void | Promise<void>
  > = [];
  const defaultMetrics: NonNullable<RealtimeChatGatewayRuntimeDeps['metrics']> = {
    increment: vi.fn()
  };

  const acceptedMessage: MessageCommandResponse = {
    status: 'accepted',
    commandId: 'command-1',
    clientMessageId: 'client-message-1',
    messageId: 'message-1',
    streamId: 'stream-channel-1',
    streamType: 'CHANNEL',
    sequence: 10,
    serverCreatedAt: fixedNow.toISOString()
  };
  const readCursor: MarkReadCursorResponse = {
    status: 'advanced',
    commandId: 'command-1',
    streamId: 'stream-channel-1',
    lastReadSequence: 10,
    updatedAt: fixedNow.toISOString()
  };
  const syncResponse: SyncStreamMessagesResponse = {
    streamId: 'stream-channel-1',
    messages: [],
    hasMoreBefore: false,
    hasMoreAfter: false
  };

  const deps: RealtimeChatGatewayRuntimeDeps = {
    chatApiClient: {
      issueGatewayTicket: vi.fn(async () => ({
        ticket: 'ticket-1',
        expiresAt: fixedNow.toISOString()
      })),
      sendChannelMessage: vi.fn(async (request) => ({
        ...acceptedMessage,
        commandId: request.requestId,
        clientMessageId: request.clientMessageId
      })),
      sendDMMessage: vi.fn(async (request) => ({
        ...acceptedMessage,
        commandId: request.requestId,
        clientMessageId: request.clientMessageId
      })),
      replyThreadMessage: vi.fn(async (request) => ({
        ...acceptedMessage,
        commandId: request.requestId,
        clientMessageId: request.clientMessageId
      })),
      markReadCursor: vi.fn(async (request) => ({
        ...readCursor,
        commandId: request.requestId,
        streamId: request.streamId,
        lastReadSequence: request.lastReadSequence
      })),
      syncStreamMessages: vi.fn(async (request) => ({
        ...syncResponse,
        streamId: request.streamId
      }))
    },
    gatewayTicketPort: {
      consume: vi.fn(async (ticketValue) => ({
        status: 'consumed' as const,
        ticket: {
          actorId: ticketValue,
          workspaceId: 'workspace-1',
          consumedAt: fixedNow.toISOString()
        }
      }))
    },
    outboundEventBus: {
      subscribe: vi.fn(async (handler) => {
        outboundHandlers.push(handler);
        return {
          unsubscribe: vi.fn()
        };
      })
    },
    clock: {
      now: vi.fn(() => fixedNow)
    },
    idGenerator: {
      generateId: vi.fn((scope) => `${scope}-${++idSequence}`)
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    metrics: defaultMetrics
  };

  return {
    deps: {
      chatApiClient: {
        ...deps.chatApiClient,
        ...overrides.chatApiClient
      },
      gatewayTicketPort: {
        ...deps.gatewayTicketPort,
        ...overrides.gatewayTicketPort
      },
      outboundEventBus: {
        ...deps.outboundEventBus,
        ...overrides.outboundEventBus
      },
      clock: {
        ...deps.clock,
        ...overrides.clock
      },
      idGenerator: {
        ...deps.idGenerator,
        ...overrides.idGenerator
      },
      logger: {
        ...deps.logger,
        ...overrides.logger
      },
      metrics: overrides.metrics ?? defaultMetrics
    },
    outboundHandlers
  };
}

export class FakeWebSocketConnection implements WebSocketConnectionLike {
  readonly id?: string;
  readonly query: Record<string, string | undefined>;
  readonly headers: Record<string, string | undefined>;
  readonly sent: string[] = [];
  closed?: { code?: number; reason?: string };
  private messageHandler?:
    | ((payload: WebSocketMessagePayload) => void | Promise<void>)
    | undefined;
  private closeHandler?: (() => void | Promise<void>) | undefined;

  constructor(input: {
    id?: string;
    query?: Record<string, string | undefined>;
    headers?: Record<string, string | undefined>;
  } = {}) {
    if (input.id !== undefined) {
      this.id = input.id;
    }

    this.query = input.query ?? {};
    this.headers = input.headers ?? {};
  }

  async send(payload: string): Promise<void> {
    this.sent.push(payload);
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.closed = {
      ...(code !== undefined ? { code } : {}),
      ...(reason !== undefined ? { reason } : {})
    };
  }

  onMessage(
    handler: (payload: WebSocketMessagePayload) => void | Promise<void>
  ): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void | Promise<void>): void {
    this.closeHandler = handler;
  }

  async receive(payload: WebSocketMessagePayload): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('message handler is not registered');
    }

    await this.messageHandler(payload);
  }

  async disconnect(): Promise<void> {
    await this.closeHandler?.();
  }

  sentEvents(): unknown[] {
    return this.sent.map((payload) => JSON.parse(payload));
  }
}

export function httpRequest(input: {
  params?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}) {
  return {
    params: input.params ?? {},
    query: input.query ?? {},
    headers: input.headers ?? {},
    ...(input.body !== undefined ? { body: input.body } : {})
  };
}

export function createdMessageEvent(
  overrides: Partial<PublicMessageDto> = {}
): OutboundMessageDeliveryRequested['payload'] {
  return {
    type: 'chat.message.created',
    messageId: overrides.messageId ?? 'message-1',
    streamId: overrides.streamId ?? 'stream-channel-1',
    streamType: overrides.streamType ?? 'CHANNEL',
    sequence: overrides.sequence ?? 10,
    ...(overrides.senderId ? { senderId: overrides.senderId } : {}),
    messageType: overrides.messageType ?? 'USER',
    content: overrides.content ?? {
      kind: 'text',
      text: '안녕하세요'
    },
    createdAt: overrides.createdAt ?? fixedNow.toISOString()
  };
}

export function rejectedTicket(
  reason: RealtimeChatErrorCode,
  message?: string
) {
  return {
    status: 'rejected' as const,
    reason,
    ...(message ? { message } : {})
  };
}

function streamIdForTarget(
  target: Parameters<RealtimeChatApiRuntimeDeps['db']['appendMessage']>[0]['target']
): string {
  if (target.kind === 'channel') {
    return `stream-channel-${target.channelId}`;
  }

  if (target.kind === 'dm') {
    return `stream-dm-${target.dmConversationId}`;
  }

  return `stream-thread-${target.threadId}`;
}
