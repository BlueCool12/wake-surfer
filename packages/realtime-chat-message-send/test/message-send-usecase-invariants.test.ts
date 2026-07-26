import type { PublicMessage } from "@wake-surfer/realtime-chat-message-send-contracts";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { createDefaultMessageTargetResolver } from "../src";
import type { MessageSendDatabase } from "../src/message-send-table";
import {
  sendMessage,
  type SendMessageDeps,
} from "../src/usecases/send-message/send-message.usecase";

const db = {} as Kysely<MessageSendDatabase>;

const savedMessage: PublicMessage = {
  messageId: "message-1",
  streamId: "channel:channel-1",
  sequence: 1,
  senderActorId: "actor-1",
  target: {
    type: "channel",
    channelId: "channel-1",
  },
  content: {
    type: "text",
    text: "hello",
  },
  createdAt: "2026-07-11T00:00:00.000Z",
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
  findAcceptedMessageByClientMessageId: async () => undefined,
  appendMessage: async () => ({
    status: "created",
    message: savedMessage,
  }),
};

describe("send message usecase invariants", () => {
  it("rejects a blank actorId before touching persistence", async () => {
    await expect(
      sendMessage(
        {
          clientMessageId: "client-message-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          content: {
            type: "text",
            text: "hello",
          },
        },
        {
          actorId: " ",
        },
        baseDeps,
      ),
    ).rejects.toThrow("actorId");
  });

  it("returns rejected for invalid text content", async () => {
    await expect(
      sendMessage(
        {
          clientMessageId: "client-message-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          content: {
            type: "text",
            text: " ",
          },
        },
        {
          actorId: "actor-1",
        },
        baseDeps,
      ),
    ).resolves.toEqual({
      status: "rejected",
      clientMessageId: "client-message-1",
      reason: "invalid_content",
    });
  });

  it("rejects an oversized text command before resolving or appending", async () => {
    let resolveCount = 0;
    let appendCount = 0;

    await expect(
      sendMessage(
        {
          clientMessageId: "client-message-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          content: {
            type: "text",
            text: "a".repeat(8_193),
          },
        },
        {
          actorId: "actor-1",
        },
        {
          ...baseDeps,
          resolveTarget: () => {
            resolveCount += 1;
            return baseDeps.resolveTarget({
              actorId: "actor-1",
              target: {
                type: "channel",
                channelId: "channel-1",
              },
            });
          },
          appendMessage: async (...args) => {
            appendCount += 1;
            return baseDeps.appendMessage(...args);
          },
        },
      ),
    ).resolves.toEqual({
      status: "rejected",
      clientMessageId: "client-message-1",
      reason: "invalid_content",
    });

    expect(resolveCount).toBe(0);
    expect(appendCount).toBe(0);
  });

  it("derives the default resolved stream ID from the shared canonical helper", () => {
    expect(
      createDefaultMessageTargetResolver()({
        actorId: "actor-1",
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

  it("returns rejected when the target resolver cannot resolve a stream", async () => {
    await expect(
      sendMessage(
        {
          clientMessageId: "client-message-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          content: {
            type: "text",
            text: "hello",
          },
        },
        {
          actorId: "actor-1",
        },
        {
          ...baseDeps,
          resolveTarget: () => ({
            status: "rejected",
            reason: "target_not_found",
          }),
        },
      ),
    ).resolves.toEqual({
      status: "rejected",
      clientMessageId: "client-message-1",
      reason: "target_not_found",
    });
  });

  it("returns an existing accepted result for the same clientMessageId", async () => {
    await expect(
      sendMessage(
        {
          clientMessageId: "client-message-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          content: {
            type: "text",
            text: "hello",
          },
        },
        {
          actorId: "actor-1",
        },
        {
          ...baseDeps,
          authorizeWrite: () => {
            throw new Error("기존 메시지 재시도는 권한을 다시 확인하지 않습니다.");
          },
          findAcceptedMessageByClientMessageId: async () => savedMessage,
        },
      ),
    ).resolves.toEqual({
      status: "accepted",
      clientMessageId: "client-message-1",
      message: savedMessage,
    });
  });

  it("returns a concurrently appended message without publishing delivery again", async () => {
    let publishCount = 0;

    await expect(
      sendMessage(
        {
          clientMessageId: "client-message-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          content: {
            type: "text",
            text: "hello",
          },
        },
        {
          actorId: "actor-1",
        },
        {
          ...baseDeps,
          appendMessage: async () => ({
            status: "existing",
            message: savedMessage,
          }),
          publishDeliveryRequested: () => {
            publishCount += 1;
          },
        },
      ),
    ).resolves.toEqual({
      status: "accepted",
      clientMessageId: "client-message-1",
      message: savedMessage,
    });

    expect(publishCount).toBe(0);
  });

  it("keeps the accepted result when delivery publish fails", async () => {
    await expect(
      sendMessage(
        {
          commandId: "command-1",
          clientMessageId: "client-message-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          content: {
            type: "text",
            text: "hello",
          },
        },
        {
          actorId: "actor-1",
        },
        {
          ...baseDeps,
          publishDeliveryRequested: () => {
            throw new Error("broker unavailable");
          },
        },
      ),
    ).resolves.toEqual({
      status: "accepted",
      commandId: "command-1",
      clientMessageId: "client-message-1",
      message: savedMessage,
    });
  });
});
