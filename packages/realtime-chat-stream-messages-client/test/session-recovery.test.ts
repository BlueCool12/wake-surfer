import { describe, expect, it, vi } from "vitest";

import {
  StreamMessagesSessionModel,
  StreamMessagesTransportError,
  createStreamMessagesCursorStorage,
  type KeyValueStorage,
  type StreamMessagesTransport,
} from "../src/index.js";

describe("Stream Messages cursor recovery", () => {
  it("uses latest only when no trusted cursor exists", async () => {
    const storage = createMemoryStorage();
    const transport = createTransport({
      loadLatest: vi.fn(async () => ({
        response: {
          streamId: "channel:channel-recovery",
          throughSequence: 2,
          messages: createMessages(1, 2),
          nextBeforeSequence: 1,
          hasMoreBefore: false,
        },
        rawUtf8ByteLength: 400,
      })),
    });
    const session = createSession(storage);

    await session.bootstrap(transport);

    expect(transport.loadLatest).toHaveBeenCalledOnce();
    expect(transport.syncAfter).not.toHaveBeenCalled();
    expect(session.timeline.deliverySyncCursor).toBe(2);
    expect(session.recovery.phase).toBe("ready");
    expect(storage.values()[0]).not.toContain("message 1");
  });

  it("restores a cursor and keeps one watermark across multiple pages", async () => {
    const storage = createMemoryStorage();
    createCursorStorage(storage).save({
      deliverySyncCursor: 2,
      throughSequence: null,
      recoveryState: "idle",
    });
    const requested: { afterSequence: number; throughSequence?: number }[] = [];
    const transport = createTransport({
      syncAfter: vi.fn(async (request) => {
        requested.push({
          afterSequence: request.afterSequence,
          ...(request.throughSequence === undefined
            ? {}
            : { throughSequence: request.throughSequence }),
        });

        if (request.afterSequence === 2) {
          return {
            response: {
              streamId: "channel:channel-recovery",
              afterSequence: 2,
              throughSequence: 5,
              messages: createMessages(3, 4),
              nextAfterSequence: 4,
              hasMoreAfter: true,
            },
            rawUtf8ByteLength: 500,
          };
        }

        return {
          response: {
            streamId: "channel:channel-recovery",
            afterSequence: 4,
            throughSequence: 5,
            messages: createMessages(5, 5),
            nextAfterSequence: 5,
            hasMoreAfter: false,
          },
          rawUtf8ByteLength: 300,
        };
      }),
    });
    const session = createSession(storage);

    await session.bootstrap(transport);

    expect(requested).toEqual([{ afterSequence: 2 }, { afterSequence: 4, throughSequence: 5 }]);
    expect(session.timeline.deliverySyncCursor).toBe(5);
    expect(session.recovery.throughSequence).toBeNull();
    expect(session.recovery.phase).toBe("ready");
  });

  it("persists only the last fully applied page when a later page fails", async () => {
    const storage = createMemoryStorage();
    createCursorStorage(storage).save({
      deliverySyncCursor: 0,
      throughSequence: null,
      recoveryState: "idle",
    });
    const transport = createTransport({
      syncAfter: vi.fn(async (request) => {
        if (request.afterSequence === 0) {
          return {
            response: {
              streamId: "channel:channel-recovery",
              afterSequence: 0,
              throughSequence: 2,
              messages: createMessages(1, 1),
              nextAfterSequence: 1,
              hasMoreAfter: true,
            },
            rawUtf8ByteLength: 200,
          };
        }

        throw new StreamMessagesTransportError("stream_messages_unavailable", {
          retryable: true,
        });
      }),
    });
    const session = createSession(storage);

    await session.bootstrap(transport);

    expect(session.timeline.deliverySyncCursor).toBe(1);
    expect(session.recovery.phase).toBe("retryable_failure");
    expect(createCursorStorage(storage).load()).toEqual({
      deliverySyncCursor: 1,
      throughSequence: 2,
      recoveryState: "idle",
    });

    const resumedTransport = createTransport({
      syncAfter: vi.fn(async (request) => ({
        response: {
          streamId: "channel:channel-recovery",
          afterSequence: request.afterSequence,
          throughSequence: request.throughSequence!,
          messages: createMessages(2, 2),
          nextAfterSequence: 2,
          hasMoreAfter: false,
        },
        rawUtf8ByteLength: 200,
      })),
    });
    const resumedSession = createSession(storage);
    await resumedSession.bootstrap(resumedTransport);

    expect(resumedTransport.syncAfter).toHaveBeenCalledWith(
      expect.objectContaining({ afterSequence: 1, throughSequence: 2 }),
      expect.any(Object),
    );
    expect(resumedSession.timeline.deliverySyncCursor).toBe(2);
  });

  it("waits for rate-limit retry without advancing the cursor", async () => {
    const storage = createMemoryStorage();
    createCursorStorage(storage).save({
      deliverySyncCursor: 0,
      throughSequence: null,
      recoveryState: "idle",
    });
    const delay = vi.fn(async () => undefined);
    let attempts = 0;
    const transport = createTransport({
      syncAfter: vi.fn(async (request) => {
        attempts += 1;

        if (attempts === 1) {
          throw new StreamMessagesTransportError("rate_limited", { retryAfterMs: 250 });
        }

        return {
          response: {
            streamId: "channel:channel-recovery",
            afterSequence: request.afterSequence,
            throughSequence: 1,
            messages: createMessages(1, 1),
            nextAfterSequence: 1,
            hasMoreAfter: false,
          },
          rawUtf8ByteLength: 200,
        };
      }),
    });
    const session = createSession(storage, { delay });

    await session.bootstrap(transport);

    expect(delay).toHaveBeenCalledWith(250, expect.any(AbortSignal));
    expect(transport.syncAfter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ afterSequence: 0 }),
      expect.any(Object),
    );
    expect(session.timeline.deliverySyncCursor).toBe(1);
  });

  it("yields after ten successful pages and automatically continues the same recovery", async () => {
    const storage = createMemoryStorage();
    createCursorStorage(storage).save({
      deliverySyncCursor: 0,
      throughSequence: null,
      recoveryState: "idle",
    });
    const yieldControl = vi.fn(async () => undefined);
    const transport = createTransport({
      syncAfter: vi.fn(async (request) => {
        const sequence = request.afterSequence + 1;

        return {
          response: {
            streamId: "channel:channel-recovery",
            afterSequence: request.afterSequence,
            throughSequence: 11,
            messages: createMessages(sequence, sequence),
            nextAfterSequence: sequence,
            hasMoreAfter: sequence < 11,
          },
          rawUtf8ByteLength: 200,
        };
      }),
    });
    const session = createSession(storage, { yieldControl });

    await session.bootstrap(transport);

    expect(transport.syncAfter).toHaveBeenCalledTimes(11);
    expect(yieldControl).toHaveBeenCalledOnce();
    expect(session.timeline.deliverySyncCursor).toBe(11);
    expect(session.recovery.phase).toBe("ready");
  });

  it("does not advance the cursor when recovery is cancelled before a page applies", async () => {
    const storage = createMemoryStorage();
    createCursorStorage(storage).save({
      deliverySyncCursor: 0,
      throughSequence: null,
      recoveryState: "idle",
    });
    let resolvePage:
      ((value: Awaited<ReturnType<StreamMessagesTransport["syncAfter"]>>) => void) | undefined;
    const transport = createTransport({
      syncAfter: vi.fn<StreamMessagesTransport["syncAfter"]>(
        () =>
          new Promise<Awaited<ReturnType<StreamMessagesTransport["syncAfter"]>>>((resolve) => {
            resolvePage = resolve;
          }),
      ),
    });
    const session = createSession(storage);
    const recovery = session.bootstrap(transport);
    await Promise.resolve();
    session.cancel();
    resolvePage?.({
      response: {
        streamId: "channel:channel-recovery",
        afterSequence: 0,
        throughSequence: 1,
        messages: createMessages(1, 1),
        nextAfterSequence: 1,
        hasMoreAfter: false,
      },
      rawUtf8ByteLength: 200,
    });
    await recovery;

    expect(session.timeline.deliverySyncCursor).toBe(0);
    expect(session.recovery.phase).toBe("cancelled");
  });

  it("does not apply an older page that completes after session cancellation", async () => {
    const storage = createMemoryStorage();
    const session = createSession(storage);
    await session.bootstrap(
      createTransport({
        loadLatest: vi.fn(async () => ({
          response: {
            streamId: "channel:channel-recovery",
            throughSequence: 3,
            messages: createMessages(2, 3),
            nextBeforeSequence: 2,
            hasMoreBefore: true,
          },
          rawUtf8ByteLength: 200,
        })),
      }),
    );
    let resolveOlder:
      ((value: Awaited<ReturnType<StreamMessagesTransport["loadOlder"]>>) => void) | undefined;
    const transport = createTransport({
      loadOlder: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<StreamMessagesTransport["loadOlder"]>>>((resolve) => {
            resolveOlder = resolve;
          }),
      ),
    });
    const older = session.loadOlder(transport);
    await Promise.resolve();
    session.cancel();
    resolveOlder?.({
      response: {
        streamId: "channel:channel-recovery",
        beforeSequence: 2,
        messages: createMessages(1, 1),
        nextBeforeSequence: 1,
        hasMoreBefore: false,
      },
      rawUtf8ByteLength: 100,
    });

    await expect(older).rejects.toMatchObject({ code: "cancelled" });
    expect(session.timeline.messages.map((message) => message.sequence)).toEqual([2, 3]);
  });

  function createSession(
    storage: KeyValueStorage,
    overrides: Partial<ConstructorParameters<typeof StreamMessagesSessionModel>[0]> = {},
  ) {
    return new StreamMessagesSessionModel({
      actorId: "actor-recovery",
      channelId: "channel-recovery",
      storage,
      yieldControl: vi.fn(async () => undefined),
      ...overrides,
    });
  }

  function createCursorStorage(storage: KeyValueStorage) {
    return createStreamMessagesCursorStorage({
      actorId: "actor-recovery",
      channelId: "channel-recovery",
      storage,
    });
  }
});

function createTransport(overrides: Partial<StreamMessagesTransport>): StreamMessagesTransport {
  return {
    loadLatest:
      overrides.loadLatest ??
      vi.fn(async () => {
        throw new Error("loadLatest was not configured");
      }),
    loadOlder:
      overrides.loadOlder ??
      vi.fn(async () => {
        throw new Error("loadOlder was not configured");
      }),
    syncAfter:
      overrides.syncAfter ??
      vi.fn(async () => {
        throw new Error("syncAfter was not configured");
      }),
  };
}

function createMemoryStorage(): KeyValueStorage & { values: () => string[] } {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    values: () => [...values.values()],
  };
}

function createMessages(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => createMessage(first + index));
}

function createMessage(sequence: number) {
  return {
    messageId: `message-${sequence}`,
    streamId: "channel:channel-recovery",
    sequence,
    senderActorId: "actor-recovery",
    target: { type: "channel" as const, channelId: "channel-recovery" },
    text: `message ${sequence}`,
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}
