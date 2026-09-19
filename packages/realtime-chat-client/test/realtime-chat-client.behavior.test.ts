import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeChatClient } from "../src/index.js";

// 공개 계약을 먼저 작성한다. 클라이언트 구현과 패키지 테스트 설정은 후속 작업이다.
const channel = { type: "channel", channelId: "channel-1" } as const;
const thread = { type: "thread", threadId: "thread-1" } as const;
const unregistered = { type: "channel", channelId: "unregistered-channel" } as const;

type ChatTarget = ConstructorParameters<typeof RealtimeChatClient>[0]["targets"][number];

const clients: RealtimeChatClient[] = [];

function createClient(targets: readonly ChatTarget[] = [channel, thread]) {
  const client = new RealtimeChatClient({
    apiBaseUrl: "https://chat.example.invalid",
    actorId: "user-1",
    targets,
  });
  clients.push(client);
  return client;
}

beforeEach(() => {
  // 티켓 응답을 보류해 연결 준비 중인 상황을 유지하고 실제 네트워크 요청을 막는다.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  try {
    for (const client of clients) client.close();
  } finally {
    clients.length = 0;
    vi.unstubAllGlobals();
  }
});

describe("RealtimeChatClient 호출부", () => {
  it("생성 직후 등록된 대상의 메시지를 읽으면 빈 목록을 받는다", () => {
    const client = createClient();

    expect(client.getMessagesByTarget(channel).messages).toEqual([]);
    expect(client.getMessagesByTarget(thread).messages).toEqual([]);
  });

  it("연결 완료를 기다리지 않고 전송하면 같은 메시지가 즉시 pending으로 보인다", () => {
    const client = createClient();

    // 생성자에 넘긴 객체와 참조가 달라도 같은 종류와 ID면 등록된 대상이다.
    const outgoing = client.sendMessageForTarget(
      { type: "channel", channelId: channel.channelId },
      { text: "안녕하세요" },
    );

    expect(outgoing.status).toEqual({ status: "pending" });
    expect(client.getMessagesByTarget(channel).messages).toEqual([
      expect.objectContaining({
        key: outgoing.key,
        content: { type: "text", text: "안녕하세요" },
        status: { status: "pending" },
      }),
    ]);
    expect(client.getMessagesByTarget(thread).messages).toEqual([]);
  });

  it("각 화면은 자신이 구독한 대상의 메시지 변경을 받는다", async () => {
    const client = createClient();
    const channelScreen = vi.fn();
    const threadScreen = vi.fn();
    client.subscribeMessagesForTarget(channel, () => {
      channelScreen(client.getMessagesByTarget(channel));
    });
    client.subscribeMessagesForTarget(thread, () => {
      threadScreen(client.getMessagesByTarget(thread));
    });
    // 구독 시 초기 알림을 보내는지는 이 테스트에서 규정하지 않는다.
    channelScreen.mockClear();
    threadScreen.mockClear();

    const outgoing = client.sendMessageForTarget(channel, { text: "채널 메시지" });

    await vi.waitFor(() => {
      expect(channelScreen).toHaveBeenLastCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ key: outgoing.key })],
        }),
      );
    });
    expect(threadScreen).not.toHaveBeenCalled();
    expect(client.getMessagesByTarget(thread).messages).toEqual([]);
  });

  it("화면 구독을 해제해도 대상은 유지되고 다른 화면은 계속 변경을 받는다", async () => {
    const client = createClient();
    const leavingScreen = vi.fn();
    const remainingScreen = vi.fn();
    const unsubscribe = client.subscribeMessagesForTarget(channel, () => {
      leavingScreen(client.getMessagesByTarget(channel));
    });
    client.subscribeMessagesForTarget(channel, () => {
      remainingScreen(client.getMessagesByTarget(channel));
    });

    const first = client.sendMessageForTarget(channel, { text: "첫 번째 메시지" });
    await vi.waitFor(() => {
      const expected = expect.objectContaining({
        messages: [expect.objectContaining({ key: first.key })],
      });
      expect(leavingScreen).toHaveBeenLastCalledWith(expected);
      expect(remainingScreen).toHaveBeenLastCalledWith(expected);
    });

    unsubscribe();
    leavingScreen.mockClear();
    remainingScreen.mockClear();
    const outgoing = client.sendMessageForTarget(channel, { text: "두 번째 메시지" });

    await vi.waitFor(() => {
      expect(remainingScreen).toHaveBeenLastCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ key: first.key }),
            expect.objectContaining({ key: outgoing.key }),
          ],
        }),
      );
    });
    expect(leavingScreen).not.toHaveBeenCalled();
    expect(client.getMessagesByTarget(channel).messages).toEqual([
      expect.objectContaining({ content: { type: "text", text: "첫 번째 메시지" } }),
      expect.objectContaining({ key: outgoing.key }),
    ]);
  });

  it("빈 대상 목록으로 시작해 대상을 추가하고 사용 전 제거할 수 있다", () => {
    const client = createClient([]);

    expect(() => client.getMessagesByTarget(channel)).toThrow();

    client.addTarget(channel);
    expect(client.getMessagesByTarget(channel).messages).toEqual([]);

    // 대기 전송이나 리스너가 있는 대상의 제거 정책은 아직 정하지 않았다.
    client.removeTarget(channel);
    expect(() => client.getMessagesByTarget(channel)).toThrow();
  });

  const targetOperations: Array<{
    name: string;
    call: (client: RealtimeChatClient, target: ChatTarget) => unknown;
  }> = [
    { name: "getMessagesByTarget", call: (client, target) => client.getMessagesByTarget(target) },
    {
      name: "loadLatestMessagesForTarget",
      call: (client, target) => client.loadLatestMessagesForTarget(target),
    },
    {
      name: "loadOlderMessagesForTarget",
      call: (client, target) => client.loadOlderMessagesForTarget(target),
    },
    {
      name: "subscribeMessagesForTarget",
      call: (client, target) => client.subscribeMessagesForTarget(target, vi.fn()),
    },
    {
      name: "sendMessageForTarget",
      call: (client, target) => client.sendMessageForTarget(target, { text: "전송하면 안 됨" }),
    },
  ];

  it.each(targetOperations)("미등록 대상으로 $name을 호출하면 즉시 throw한다", ({ call }) => {
    const client = createClient();
    let thrown: unknown;

    try {
      const result = call(client, unregistered);
      // Promise 거절로 잘못 구현한 경우에도 아래 동기 예외 검증에서 실패하게 한다.
      if (result instanceof Promise) void result.catch(() => {});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ code: "target_not_registered" });
    expect(() => client.getMessagesByTarget(unregistered)).toThrow();
    expect(client.getMessagesByTarget(channel).messages).toEqual([]);
    expect(client.getMessagesByTarget(thread).messages).toEqual([]);
  });
});
