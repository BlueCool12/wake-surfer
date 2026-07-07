import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  GatewayAssignmentPort,
  LoggerPort,
  PermissionPort,
} from "@wake-surfer/realtime-chat/api";
import { createApp as createApiApp } from "../../realtime-chat-api/src/app";
import { loadEnv as loadApiEnv } from "../../realtime-chat-api/src/config/env";
import { createInMemoryRealtimeChatDb } from "../../realtime-chat-api/src/runtime/in-memory-realtime-chat-db";
import { createNodeIdGenerator } from "../../realtime-chat-api/src/runtime/id-generator";
import { createNoopMetrics } from "../../realtime-chat-api/src/runtime/metrics";
import { createRedisOutboundEventBus } from "../../realtime-chat-api/src/runtime/redis-outbound-event-bus";
import { createNodeGatewayTicketHasher } from "../../realtime-chat-api/src/runtime/ticket-hasher";
import type { RealtimeChatApiRuntimeHandle } from "../../realtime-chat-api/src/runtime/create-runtime-deps";

type RunningService = {
  name: string;
  process: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
};

type RunningApiServer = {
  close: () => Promise<void>;
};

type IssueGatewayTicketResponse = {
  ticket: string;
  gatewayUrl: string;
  expiresAt: string;
};

type ChannelMembers = Map<string, string[]>;
type GatewayAssignments = Map<string, { gatewayId: string; gatewayUrl: string }>;

const testDir = dirname(fileURLToPath(import.meta.url));
const gatewayDir = resolve(testDir, "..");

describe("realtime chat services E2E", () => {
  const services: RunningService[] = [];
  let apiServer: RunningApiServer | undefined;
  let apiPort = 0;
  let senderGatewayPort = 0;
  let receiverGatewayPort = 0;
  let apiBaseUrl = "";
  let senderGatewayUrl = "";
  let receiverGatewayUrl = "";

  beforeAll(async () => {
    assertBuilt(gatewayDir);

    apiPort = await getFreePort();
    senderGatewayPort = await getFreePort();
    receiverGatewayPort = await getFreePort();
    apiBaseUrl = `http://127.0.0.1:${apiPort}/api/realtime-chat`;
    senderGatewayUrl = `ws://127.0.0.1:${senderGatewayPort}/ws/realtime-chat`;
    receiverGatewayUrl = `ws://127.0.0.1:${receiverGatewayPort}/ws/realtime-chat`;

    const redisChannel = `realtime-chat:e2e:${Date.now()}:${process.pid}`;
    const channelMembers: ChannelMembers = new Map([
      [
        channelMemberKey("workspace-e2e", "channel-e2e-same-gateway"),
        ["sender-same-gateway", "receiver-same-gateway"],
      ],
      [
        channelMemberKey("workspace-e2e", "channel-e2e-different-gateway"),
        ["sender-different-gateway", "receiver-different-gateway"],
      ],
    ]);
    const gatewayAssignments: GatewayAssignments = new Map([
      [
        "sender-same-gateway",
        {
          gatewayId: "e2e-sender-gateway",
          gatewayUrl: senderGatewayUrl,
        },
      ],
      [
        "receiver-same-gateway",
        {
          gatewayId: "e2e-sender-gateway",
          gatewayUrl: senderGatewayUrl,
        },
      ],
      [
        "sender-different-gateway",
        {
          gatewayId: "e2e-sender-gateway",
          gatewayUrl: senderGatewayUrl,
        },
      ],
      [
        "receiver-different-gateway",
        {
          gatewayId: "e2e-receiver-gateway",
          gatewayUrl: receiverGatewayUrl,
        },
      ],
    ]);

    apiServer = await startTestApiServer({
      port: apiPort,
      gatewayUrl: senderGatewayUrl,
      redisChannel,
      channelMembers,
      gatewayAssignments,
    });
    await waitForHttpReady(`http://127.0.0.1:${apiPort}/readyz`);

    const senderGateway = startService({
      name: "realtime-chat-sender-gateway",
      cwd: gatewayDir,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(senderGatewayPort),
        LOG_LEVEL: "silent",
        REALTIME_CHAT_GATEWAY_PATH: "/ws/realtime-chat",
        GATEWAY_ID: "e2e-sender-gateway",
        REALTIME_CHAT_API_BASE_URL: apiBaseUrl,
        MAX_PAYLOAD_BYTES: "65536",
        REDIS_URL: "redis://127.0.0.1:6379",
        REALTIME_CHAT_OUTBOUND_CHANNEL: redisChannel,
      },
    });
    services.push(senderGateway);
    await waitForReady(senderGateway, `http://127.0.0.1:${senderGatewayPort}/readyz`);

    const receiverGateway = startService({
      name: "realtime-chat-receiver-gateway",
      cwd: gatewayDir,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(receiverGatewayPort),
        LOG_LEVEL: "silent",
        REALTIME_CHAT_GATEWAY_PATH: "/ws/realtime-chat",
        GATEWAY_ID: "e2e-receiver-gateway",
        REALTIME_CHAT_API_BASE_URL: apiBaseUrl,
        MAX_PAYLOAD_BYTES: "65536",
        REDIS_URL: "redis://127.0.0.1:6379",
        REALTIME_CHAT_OUTBOUND_CHANNEL: redisChannel,
      },
    });
    services.push(receiverGateway);
    await waitForReady(receiverGateway, `http://127.0.0.1:${receiverGatewayPort}/readyz`);
  });

  afterAll(async () => {
    await Promise.all([...services].reverse().map(stopService));
    await apiServer?.close();
  });

  it("sender와 receiver가 같은 gateway에 붙으면 receiver에게 delivery한다", async () => {
    await expectJson(`http://127.0.0.1:${apiPort}/healthz`, {
      status: "ok",
      service: "@wake-surfer/realtime-chat-api",
    });
    await expectJson(`http://127.0.0.1:${senderGatewayPort}/healthz`, {
      status: "ok",
      service: "@wake-surfer/realtime-chat-gateway",
    });

    const sender = await connectGatewaySession("sender-same-gateway", "e2e-sender-gateway");
    const receiver = await connectGatewaySession("receiver-same-gateway", "e2e-sender-gateway");

    try {
      const receiverDelivery = nextJsonMessage(receiver);

      sender.send(
        channelMessageCommand({
          commandId: "command-e2e-same-gateway",
          clientMessageId: "client-message-e2e-same-gateway",
          channelId: "channel-e2e-same-gateway",
          text: "same gateway delivery",
        }),
      );

      const senderEvents = await nextJsonMessages(sender, 2);
      const receiverEvent = await receiverDelivery;

      expect(senderEvents).toContainEqual({
        type: "chat.message.accepted",
        commandId: "command-e2e-same-gateway",
        clientMessageId: "client-message-e2e-same-gateway",
        messageId: expect.stringMatching(/^message_/),
        streamId: "channel:workspace-e2e:channel-e2e-same-gateway",
        sequence: expect.any(Number),
        serverCreatedAt: expect.any(String),
      });
      expect(senderEvents).toContainEqual(
        createdMessageEvent({
          streamId: "channel:workspace-e2e:channel-e2e-same-gateway",
          senderId: "sender-same-gateway",
          text: "same gateway delivery",
        }),
      );
      expect(receiverEvent).toEqual(
        createdMessageEvent({
          streamId: "channel:workspace-e2e:channel-e2e-same-gateway",
          senderId: "sender-same-gateway",
          text: "same gateway delivery",
        }),
      );
    } finally {
      sender.close();
      receiver.close();
    }
  });

  it("sender와 receiver가 다른 gateway에 붙으면 receiver gateway로 delivery한다", async () => {
    await expectJson(`http://127.0.0.1:${receiverGatewayPort}/healthz`, {
      status: "ok",
      service: "@wake-surfer/realtime-chat-gateway",
    });

    const sender = await connectGatewaySession("sender-different-gateway", "e2e-sender-gateway");
    const receiver = await connectGatewaySession(
      "receiver-different-gateway",
      "e2e-receiver-gateway",
    );

    try {
      const receiverDelivery = nextJsonMessage(receiver);

      sender.send(
        channelMessageCommand({
          commandId: "command-e2e-different-gateway",
          clientMessageId: "client-message-e2e-different-gateway",
          channelId: "channel-e2e-different-gateway",
          text: "different gateway delivery",
        }),
      );

      const senderEvents = await nextJsonMessages(sender, 2);
      const receiverEvent = await receiverDelivery;

      expect(senderEvents).toContainEqual({
        type: "chat.message.accepted",
        commandId: "command-e2e-different-gateway",
        clientMessageId: "client-message-e2e-different-gateway",
        messageId: expect.stringMatching(/^message_/),
        streamId: "channel:workspace-e2e:channel-e2e-different-gateway",
        sequence: expect.any(Number),
        serverCreatedAt: expect.any(String),
      });
      expect(receiverEvent).toEqual(
        createdMessageEvent({
          streamId: "channel:workspace-e2e:channel-e2e-different-gateway",
          senderId: "sender-different-gateway",
          text: "different gateway delivery",
        }),
      );
    } finally {
      sender.close();
      receiver.close();
    }
  });

  async function issueGatewayTicket(actorId: string): Promise<IssueGatewayTicketResponse> {
    const response = await fetch(`${apiBaseUrl}/gateway-tickets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": actorId,
      },
      body: JSON.stringify({}),
    });
    const body = (await response.json()) as IssueGatewayTicketResponse;

    expect(response.status).toBe(201);
    expect(body).toEqual({
      ticket: expect.any(String),
      gatewayUrl: expect.any(String),
      expiresAt: expect.any(String),
    });

    return body;
  }

  async function connectGatewaySession(actorId: string, gatewayId: string): Promise<WebSocket> {
    const issuedTicket = await issueGatewayTicket(actorId);
    const socket = new WebSocket(
      `${issuedTicket.gatewayUrl}?ticket=${encodeURIComponent(issuedTicket.ticket)}`,
    );

    await expect(nextJsonMessage(socket)).resolves.toEqual({
      type: "gateway.connected",
      sessionId: expect.stringMatching(/^gateway-session_/),
      gatewayId,
      connectedAt: expect.any(String),
    });

    return socket;
  }
});

async function startTestApiServer(input: {
  port: number;
  gatewayUrl: string;
  redisChannel: string;
  channelMembers: ChannelMembers;
  gatewayAssignments: GatewayAssignments;
}): Promise<RunningApiServer> {
  const env = loadApiEnv({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(input.port),
    LOG_LEVEL: "silent",
    REALTIME_CHAT_BASE_PATH: "/api/realtime-chat",
    REALTIME_CHAT_GATEWAY_ID: "e2e-sender-gateway",
    REALTIME_CHAT_GATEWAY_URL: input.gatewayUrl,
    GATEWAY_TICKET_TTL_SECONDS: "60",
    MAX_MESSAGE_TEXT_LENGTH: "4000",
    SYNC_DEFAULT_LIMIT: "50",
    SYNC_MAX_LIMIT: "100",
    REDIS_URL: "redis://127.0.0.1:6379",
    REALTIME_CHAT_OUTBOUND_CHANNEL: input.redisChannel,
    DATABASE_URL: "",
  });
  const api = await createApiApp(env, async (_env, logger) =>
    createTestApiRuntime(
      logger,
      input.channelMembers,
      input.gatewayAssignments,
      input.redisChannel,
    ),
  );
  const server = createHttpServer((request, response) => {
    handleHonoRequest(api.app.fetch, request, response).catch((error: unknown) => {
      response.writeHead(500, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ error: String(error) }));
    });
  });

  await listen(server, env.HOST, env.PORT);

  return {
    close: async () => {
      await closeHttpServer(server);
      await api.close();
    },
  };
}

async function createTestApiRuntime(
  logger: LoggerPort,
  channelMembers: ChannelMembers,
  gatewayAssignments: GatewayAssignments,
  redisChannel: string,
): Promise<RealtimeChatApiRuntimeHandle> {
  const outboundEventBus = await createRedisOutboundEventBus({
    redisUrl: "redis://127.0.0.1:6379",
    channel: redisChannel,
    logger,
  });

  return {
    deps: {
      db: createInMemoryRealtimeChatDb(),
      permissionPort: createTestPermissionPort(channelMembers),
      gatewayAssignmentPort: createTestGatewayAssignmentPort(gatewayAssignments),
      outboundEventBus,
      clock: {
        now: () => new Date(),
      },
      idGenerator: createNodeIdGenerator(),
      logger,
      metrics: createNoopMetrics(),
      ticketHasher: createNodeGatewayTicketHasher(),
    },
    close: async () => {
      await outboundEventBus.destroy();
    },
  };
}

function createTestGatewayAssignmentPort(
  gatewayAssignments: GatewayAssignments,
): GatewayAssignmentPort {
  return {
    async assignGatewayForTicket(input) {
      const assignment = gatewayAssignments.get(input.actorId);

      if (!assignment) {
        throw new Error(`missing test gateway assignment for actor: ${input.actorId}`);
      }

      return assignment;
    },
  };
}

function createTestPermissionPort(channelMembers: ChannelMembers): PermissionPort {
  return {
    async canIssueGatewayTicket() {
      return {
        allowed: true,
      };
    },
    async canWriteMessage() {
      return {
        allowed: true,
      };
    },
    async canReadStream() {
      return {
        allowed: true,
      };
    },
    async resolveMessageRecipients(input) {
      if (input.target.kind !== "channel") {
        return input.actorId ? [input.actorId] : [];
      }

      return (
        channelMembers.get(channelMemberKey(input.target.workspaceId, input.target.channelId)) ?? []
      );
    },
  };
}

function channelMemberKey(workspaceId: string, channelId: string): string {
  return `${workspaceId}:${channelId}`;
}

function createdMessageEvent(input: { streamId: string; senderId: string; text: string }) {
  return {
    type: "chat.message.created",
    messageId: expect.stringMatching(/^message_/),
    streamId: input.streamId,
    streamType: "CHANNEL",
    sequence: expect.any(Number),
    senderId: input.senderId,
    messageType: "USER",
    content: {
      kind: "text",
      text: input.text,
    },
    createdAt: expect.any(String),
  };
}

function channelMessageCommand(input: {
  commandId: string;
  clientMessageId: string;
  channelId: string;
  text: string;
}): string {
  return JSON.stringify({
    type: "chat.channel.message.send",
    commandId: input.commandId,
    clientMessageId: input.clientMessageId,
    workspaceId: "workspace-e2e",
    channelId: input.channelId,
    content: {
      kind: "text",
      text: input.text,
    },
    sentAtClient: new Date().toISOString(),
  });
}

function startService(input: {
  name: string;
  cwd: string;
  env: Record<string, string>;
}): RunningService {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const service: RunningService = {
    name: input.name,
    process: child,
    stdout: [],
    stderr: [],
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => service.stdout.push(chunk));
  child.stderr.on("data", (chunk) => service.stderr.push(chunk));

  return service;
}

async function stopService(service: RunningService): Promise<void> {
  if (service.process.exitCode !== null || service.process.killed) {
    return;
  }

  service.process.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (service.process.exitCode === null) {
        service.process.kill("SIGKILL");
      }
      resolve();
    }, 3_000);

    service.process.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function handleHonoRequest(
  fetchHandler: (request: Request) => Response | Promise<Response>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const fetchResponse = await fetchHandler(await toFetchRequest(request));
  const headers = Object.fromEntries(fetchResponse.headers.entries());

  response.writeHead(fetchResponse.status, headers);
  response.end(Buffer.from(await fetchResponse.arrayBuffer()));
}

async function toFetchRequest(request: IncomingMessage): Promise<Request> {
  const headers = headersFromIncomingRequest(request);
  const url = `http://${headers.get("host") ?? "127.0.0.1"}${request.url ?? "/"}`;
  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await readBody(request);

    if (body.length > 0) {
      init.body = body;
    }
  }

  return new Request(url, init);
}

function headersFromIncomingRequest(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function waitForReady(service: RunningService, url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (service.process.exitCode !== null) {
      throw new Error(`${service.name} exited before ready\n${serviceLog(service)}`);
    }

    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(100);
  }

  throw new Error(
    `${service.name} was not ready at ${url}: ${String(lastError)}\n${serviceLog(service)}`,
  );
}

async function waitForHttpReady(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(100);
  }

  throw new Error(`HTTP server was not ready at ${url}: ${String(lastError)}`);
}

async function expectJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(body);
}

function nextJsonMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${count} websocket messages`));
    }, 5_000);
    const onMessage = (data: WebSocket.RawData) => {
      messages.push(JSON.parse(data.toString()));

      if (messages.length >= count) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("websocket closed before expected messages arrived"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function nextJsonMessage(socket: WebSocket): Promise<unknown> {
  const [message] = await nextJsonMessages(socket, 1);

  return message;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a free local port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function assertBuilt(serviceDir: string): void {
  const entrypoint = resolve(serviceDir, "dist", "main.js");

  if (!existsSync(entrypoint)) {
    throw new Error(`${entrypoint} does not exist. Run the service build before E2E.`);
  }
}

function serviceLog(service: RunningService): string {
  return [`stdout:\n${service.stdout.join("")}`, `stderr:\n${service.stderr.join("")}`].join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
