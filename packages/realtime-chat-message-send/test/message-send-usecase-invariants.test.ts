import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";

import {
  createDefaultMessageTargetResolver,
  type AppendedTextMessage,
  type SendMessageInput,
} from "../src";
import type { MessageSendDatabase } from "../src/message-send-table";
import {
  sendMessage,
  type SendMessageDeps,
} from "../src/usecases/send-message/send-message.usecase";

const db = {} as Kysely<MessageSendDatabase>;
const input: SendMessageInput = {
  senderActorId: "actor-1",
  idempotencyKey: "idempotency-1",
  target: {
    type: "channel",
    channelId: "channel-1",
  },
  text: "hello",
};
const savedMessage: AppendedTextMessage = {
  messageId: "message-1",
  streamId: "channel:channel-1",
  sequence: 1,
  senderActorId: "actor-1",
  target: {
    type: "channel",
    channelId: "channel-1",
  },
  text: "hello",
  createdAt: new Date("2026-07-11T00:00:00.000Z"),
};

const baseDeps: SendMessageDeps = {
  db,
  now: () => new Date("2026-07-11T00:00:00.000Z"),
  resolveTarget: () => ({
    status: "resolved",
    streamId: "channel:channel-1",
    recipientActorIds: ["actor-2"],
  }),
  authorizeWrite: () => ({
    status: "allowed",
  }),
  messageIdGenerator: {
    generate: () => "message-1",
  },
  outboundEventIdGenerator: {
    generate: () => "event-1",
  },
  findAppendedTextMessageByIdempotencyKey: async () => undefined,
  appendTextMessage: async () => ({
    status: "created",
    message: savedMessage,
  }),
};

describe("send message usecase invariants", () => {
  it("rejects blank sender and idempotency values before persistence", async () => {
    let lookupCount = 0;
    const deps: SendMessageDeps = {
      ...baseDeps,
      findAppendedTextMessageByIdempotencyKey: async () => {
        lookupCount += 1;
        return undefined;
      },
    };

    await expect(
      sendMessage(
        {
          ...input,
          senderActorId: " ",
        },
        deps,
      ),
    ).rejects.toThrow("actorId");
    await expect(
      sendMessage(
        {
          ...input,
          idempotencyKey: " ",
        },
        deps,
      ),
    ).rejects.toThrow("idempotencyKey");
    expect(lookupCount).toBe(0);
  });

  it.each([" ", "a".repeat(8_193)])(
    "rejects invalid text before lookup, resolution, and append",
    async (text) => {
      let lookupCount = 0;
      let resolveCount = 0;
      let appendCount = 0;

      await expect(
        sendMessage(
          {
            ...input,
            text,
          },
          {
            ...baseDeps,
            findAppendedTextMessageByIdempotencyKey: async () => {
              lookupCount += 1;
              return undefined;
            },
            resolveTarget: () => {
              resolveCount += 1;
              return {
                status: "resolved",
                streamId: "channel:channel-1",
                recipientActorIds: [],
              };
            },
            appendTextMessage: async () => {
              appendCount += 1;
              return {
                status: "created",
                message: savedMessage,
              };
            },
          },
        ),
      ).resolves.toEqual({
        status: "rejected",
        reason: "invalid_text",
      });

      expect(lookupCount).toBe(0);
      expect(resolveCount).toBe(0);
      expect(appendCount).toBe(0);
    },
  );

  it("derives the default resolved stream ID from the shared canonical helper", () => {
    expect(
      createDefaultMessageTargetResolver()({
        senderActorId: "actor-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
      }),
    ).toEqual({
      status: "resolved",
      streamId: "channel:channel-1",
      recipientActorIds: [],
    });
  });

  it("returns target and authorization rejections as feature results", async () => {
    await expect(
      sendMessage(input, {
        ...baseDeps,
        resolveTarget: () => ({
          status: "rejected",
          reason: "target_not_found",
        }),
      }),
    ).resolves.toEqual({
      status: "rejected",
      reason: "target_not_found",
    });

    await expect(
      sendMessage(input, {
        ...baseDeps,
        authorizeWrite: () => ({ status: "denied" }),
      }),
    ).resolves.toEqual({
      status: "rejected",
      reason: "write_forbidden",
    });
  });

  it("returns the existing message for the same sender, key, target, and normalized text", async () => {
    await expect(
      sendMessage(
        {
          ...input,
          text: " hello ",
        },
        {
          ...baseDeps,
          findAppendedTextMessageByIdempotencyKey: async () => savedMessage,
          resolveTarget: () => {
            throw new Error("기존 메시지 재시도는 target을 다시 resolve하지 않습니다.");
          },
          authorizeWrite: () => {
            throw new Error("기존 메시지 재시도는 권한을 다시 확인하지 않습니다.");
          },
          appendTextMessage: async () => {
            throw new Error("기존 메시지 재시도는 다시 저장하지 않습니다.");
          },
        },
      ),
    ).resolves.toEqual({
      status: "accepted",
      message: savedMessage,
    });
  });

  it.each([
    {
      name: "target",
      existing: {
        ...savedMessage,
        streamId: "channel:channel-2",
        target: {
          type: "channel" as const,
          channelId: "channel-2",
        },
      },
    },
    {
      name: "text",
      existing: {
        ...savedMessage,
        text: "different",
      },
    },
  ])("rejects an existing key used with different $name", async ({ existing }) => {
    await expect(
      sendMessage(input, {
        ...baseDeps,
        findAppendedTextMessageByIdempotencyKey: async () => existing,
      }),
    ).resolves.toEqual({
      status: "rejected",
      reason: "idempotency_conflict",
    });
  });

  it("checks a concurrently appended message without publishing delivery again", async () => {
    let publishCount = 0;

    await expect(
      sendMessage(input, {
        ...baseDeps,
        appendTextMessage: async () => ({
          status: "existing",
          message: savedMessage,
        }),
        publishDeliveryRequested: () => {
          publishCount += 1;
        },
      }),
    ).resolves.toEqual({
      status: "accepted",
      message: savedMessage,
    });
    expect(publishCount).toBe(0);

    await expect(
      sendMessage(input, {
        ...baseDeps,
        appendTextMessage: async () => ({
          status: "existing",
          message: {
            ...savedMessage,
            text: "different",
          },
        }),
        publishDeliveryRequested: () => {
          publishCount += 1;
        },
      }),
    ).resolves.toEqual({
      status: "rejected",
      reason: "idempotency_conflict",
    });
    expect(publishCount).toBe(0);
  });

  it("publishes the created AcceptedTextMessage exactly once", async () => {
    const published: unknown[] = [];

    await expect(
      sendMessage(input, {
        ...baseDeps,
        publishDeliveryRequested: (event) => {
          published.push(event);
        },
      }),
    ).resolves.toEqual({
      status: "accepted",
      message: savedMessage,
    });
    expect(published).toEqual([
      {
        eventId: "event-1",
        occurredAt: "2026-07-11T00:00:00.000Z",
        message: {
          messageId: "message-1",
          streamId: "channel:channel-1",
          sequence: 1,
          senderActorId: "actor-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          text: "hello",
          createdAt: "2026-07-11T00:00:00.000Z",
        },
        recipientActorIds: ["actor-2"],
      },
    ]);
  });

  it("keeps the accepted result when delivery publish fails", async () => {
    await expect(
      sendMessage(input, {
        ...baseDeps,
        publishDeliveryRequested: () => {
          throw new Error("broker unavailable");
        },
      }),
    ).resolves.toEqual({
      status: "accepted",
      message: savedMessage,
    });
  });
});
