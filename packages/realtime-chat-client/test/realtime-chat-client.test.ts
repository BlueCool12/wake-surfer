import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeChatClient } from "../src/index.js";

const target = { type: "channel", channelId: "channel-1" } as const;
const now = "2026-09-29T00:00:00.000Z";

class Socket {
  static instances: Socket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];
  constructor(url: string | URL) { void url; Socket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  send(value: string) { this.frames.push(JSON.parse(value) as Record<string, unknown>); }
  receive(type: string, payload: object) { this.onmessage?.({ data: JSON.stringify({ type, ...payload }) }); }
  ready() { this.receive("gateway.connected", { protocolVersion: 1, gatewayId: "gateway", sessionId: "session", connectionGeneration: "1", connectedAt: now }); }
}

function response(body: unknown, init?: RequestInit) {
  return new Response(JSON.stringify(body), { headers: { "x-request-id": new Headers(init?.headers).get("x-request-id") ?? "" } });
}

describe("RealtimeChatClient", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  beforeEach(() => {
    Socket.instances = [];
    fetch.mockReset().mockImplementation(async (url, init) => {
      if (String(url).endsWith("gateway-tickets")) {
        return response({ ticket: "ticket", gatewayUrl: "wss://chat.example.test", expiresAt: now }, init);
      }
      return response({ streamId: "channel:channel-1", throughSequence: 0, messages: [], nextBeforeSequence: null, hasMoreBefore: false }, init);
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", Socket);
  });
  afterEach(() => vi.unstubAllGlobals());

  function client(authorize = () => true) {
    return new RealtimeChatClient({ apiBaseUrl: "https://chat.example.test/api/", actorId: "user-1", target, authorize });
  }

  it("대상과 HTTP 세부사항을 생성자에 감추고 최신 메시지를 결과 객체로 준다", async () => {
    await expect(client().latest()).resolves.toEqual({ ok: true, value: expect.objectContaining({ messages: [] }) });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/channels/channel-1/messages/latest");
  });

  it("입력·권한·통신 실패를 던지지 않고 결과 객체로 준다", async () => {
    await expect(client().older(-1)).resolves.toMatchObject({ ok: false });
    await expect(client(() => false).latest()).resolves.toEqual({ ok: false, message: "채팅 권한이 없습니다." });
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(client().latest()).resolves.toMatchObject({ ok: false });
  });

  it("수신 등록이 연결·채널 가입을 내부에서 처리하고 해제 후에는 전달하지 않는다", async () => {
    const received = vi.fn();
    const chat = client();
    const unsubscribe = chat.onMessage(received);
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0]!;
    socket.ready();
    await vi.waitFor(() => expect(socket.frames).toContainEqual({ type: "chat.channel.join", channelId: "channel-1" }));
    socket.receive("chat.message.created", {
      messageId: "message-1", streamId: "channel:channel-1", target, sequence: 1, senderActorId: "user-2",
      content: { type: "text", text: "hello" }, createdAt: now,
    });
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    unsubscribe();
    chat.close();
  });

  it("전송 키와 연결 절차를 감추고 서버 응답을 결과 값으로 준다", async () => {
    const chat = client();
    const sent = chat.send("hello");
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0]!;
    socket.ready();
    await vi.waitFor(() => expect(socket.frames.some((frame) => frame.type === "chat.message.send")).toBe(true));
    const frame = socket.frames.find((candidate) => candidate.type === "chat.message.send")!;
    expect(frame).toMatchObject({ target, text: "hello", idempotencyKey: expect.any(String) });
    socket.receive("chat.message.accepted", {
      status: "accepted",
      idempotencyKey: frame.idempotencyKey,
      message: {
        messageId: "message-1", streamId: "channel:channel-1", sequence: 1, senderActorId: "user-1",
        target, text: "hello", createdAt: now,
      },
    });
    await expect(sent).resolves.toMatchObject({ ok: true, value: { status: "accepted" } });
    chat.close();
  });
});
