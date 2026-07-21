import { describe, expect, it, vi } from "vitest";

import {
  createLoadLatestMessages,
  createLoadOlderMessages,
  createSyncAfterMessages,
  type ChannelReadAuthorizer,
} from "../src/index";

import type { StreamMessagesDatabase } from "../src/table-contract";
import type { Kysely } from "kysely";

describe("Stream Messages usecase boundary", () => {
  const unreachableDb = {} as Kysely<StreamMessagesDatabase>;

  it("validates each slice input before authorization and persistence", async () => {
    const authorizeRead = vi.fn<ChannelReadAuthorizer>(() => ({ status: "allowed" }));
    const dependencies = { db: unreachableDb, authorizeRead };

    await expect(
      createLoadLatestMessages(dependencies)({ channelId: " " }, { actorId: "actor-1" }),
    ).rejects.toThrow("channelId");
    await expect(
      createLoadOlderMessages(dependencies)(
        { channelId: "channel-1", beforeSequence: 0, limit: 50 },
        { actorId: "actor-1" },
      ),
    ).rejects.toThrow("beforeSequence");
    await expect(
      createSyncAfterMessages(dependencies)(
        { channelId: "channel-1", afterSequence: 2, throughSequence: 1, limit: 50 },
        { actorId: "actor-1" },
      ),
    ).rejects.toThrow("throughSequence");

    expect(authorizeRead).not.toHaveBeenCalled();
  });

  it("rejects blank authenticated actor context before persistence", async () => {
    const authorizeRead = vi.fn<ChannelReadAuthorizer>(() => ({ status: "allowed" }));

    await expect(
      createLoadLatestMessages({ db: unreachableDb, authorizeRead })(
        { channelId: "channel-1" },
        { actorId: " " },
      ),
    ).rejects.toThrow("actorId");

    expect(authorizeRead).not.toHaveBeenCalled();
  });

  it("returns denied authorization as a failure value before persistence", async () => {
    const authorizeRead = vi.fn<ChannelReadAuthorizer>(() => ({ status: "denied" }));

    await expect(
      createLoadLatestMessages({ db: unreachableDb, authorizeRead })(
        { channelId: "private-channel" },
        { actorId: "actor-denied" },
      ),
    ).resolves.toEqual({
      status: "failure",
      code: "stream_unavailable",
    });
  });
});
