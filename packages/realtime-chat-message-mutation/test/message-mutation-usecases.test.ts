import type { MessageTarget } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";

import type { DeletedMessage, EditedTextMessage, MessageMutationAuthorizer } from "../src";
import type { MessageMutationDatabase } from "../src/message-mutation-table";
import {
  executeDeleteMessage,
  type DeleteMessageExecutionDependencies,
} from "../src/usecases/delete-message/delete-message.usecase";
import {
  executeEditMessage,
  type EditMessageExecutionDependencies,
} from "../src/usecases/edit-message/edit-message.usecase";

const db = {} as Kysely<MessageMutationDatabase>;
const target: MessageTarget = {
  type: "channel",
  channelId: "channel-1",
};
const editedMessage: EditedTextMessage = {
  messageId: "message-1",
  streamId: "channel:channel-1",
  sequence: 1,
  senderActorId: "actor-1",
  target,
  version: 2,
  text: "수정한 내용",
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  editedAt: new Date("2026-08-12T00:01:00.000Z"),
};
const deletedMessage: DeletedMessage = {
  messageId: "message-1",
  streamId: "channel:channel-1",
  sequence: 1,
  senderActorId: "actor-1",
  target,
  version: 2,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  deletedAt: new Date("2026-08-12T00:01:00.000Z"),
};

const allow: MessageMutationAuthorizer = () => true;

const editDependencies: EditMessageExecutionDependencies = {
  db,
  authorize: allow,
  findTarget: async () => target,
  editOwnMessage: async () => editedMessage,
};

const deleteDependencies: DeleteMessageExecutionDependencies = {
  db,
  authorize: allow,
  findTarget: async () => target,
  deleteOwnMessage: async () => deletedMessage,
};

describe("EditMessage usecase", () => {
  it("validates actor, message identity, and content before persistence", async () => {
    let lookupCount = 0;
    const dependencies: EditMessageExecutionDependencies = {
      ...editDependencies,
      findTarget: async () => {
        lookupCount += 1;
        return target;
      },
    };

    await expect(
      executeEditMessage({ messageId: "message-1", text: "hello" }, { actorId: " " }, dependencies),
    ).rejects.toThrow("actorId");
    await expect(
      executeEditMessage({ messageId: " ", text: "hello" }, { actorId: "actor-1" }, dependencies),
    ).rejects.toThrow("messageId");

    for (const text of [" ", "a".repeat(8_193)]) {
      await expect(
        executeEditMessage({ messageId: "message-1", text }, { actorId: "actor-1" }, dependencies),
      ).resolves.toEqual({
        status: "rejected",
        reason: "invalid_content",
      });
    }

    expect(lookupCount).toBe(0);
  });

  it("authorizes the resolved target immediately before the atomic edit", async () => {
    const calls: string[] = [];
    const dependencies: EditMessageExecutionDependencies = {
      ...editDependencies,
      findTarget: async (_db, messageId) => {
        calls.push(`find:${messageId}`);
        return target;
      },
      authorize: (input) => {
        calls.push(`authorize:${input.capability}:${input.actorId}`);
        expect(input.target).toEqual(target);
        return true;
      },
      editOwnMessage: async (_db, input) => {
        calls.push(`edit:${input.messageId}:${input.actorId}:${input.text}`);
        expect(input.target).toEqual(target);
        return editedMessage;
      },
    };

    await expect(
      executeEditMessage(
        { messageId: "message-1", text: "  수정한 내용  " },
        { actorId: "actor-1" },
        dependencies,
      ),
    ).resolves.toEqual({
      status: "accepted",
      message: editedMessage,
    });
    expect(calls).toEqual([
      "find:message-1",
      "authorize:message:edit_own:actor-1",
      "edit:message-1:actor-1:수정한 내용",
    ]);
  });

  it("does not expose whether an unavailable message is missing, unauthorized, or not owned", async () => {
    let editCount = 0;
    const editOwnMessage = async () => {
      editCount += 1;
      return editedMessage;
    };

    await expect(
      executeEditMessage(
        { messageId: "message-1", text: "hello" },
        { actorId: "actor-1" },
        {
          ...editDependencies,
          findTarget: async () => undefined,
          editOwnMessage,
        },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "write_forbidden" });
    await expect(
      executeEditMessage(
        { messageId: "message-1", text: "hello" },
        { actorId: "actor-1" },
        {
          ...editDependencies,
          authorize: () => false,
          editOwnMessage,
        },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "write_forbidden" });
    await expect(
      executeEditMessage(
        { messageId: "message-1", text: "hello" },
        { actorId: "actor-1" },
        {
          ...editDependencies,
          editOwnMessage: async () => undefined,
        },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "write_forbidden" });
    expect(editCount).toBe(0);
  });

  it("returns the authoritative tombstone when deletion wins", async () => {
    await expect(
      executeEditMessage(
        { messageId: "message-1", text: "hello" },
        { actorId: "actor-1" },
        {
          ...editDependencies,
          editOwnMessage: async () => deletedMessage,
        },
      ),
    ).resolves.toEqual({
      status: "rejected",
      reason: "message_deleted",
      message: deletedMessage,
    });
  });
});

describe("DeleteMessage usecase", () => {
  it("authorizes the resolved target immediately before returning the tombstone", async () => {
    const calls: string[] = [];

    await expect(
      executeDeleteMessage(
        { messageId: "message-1" },
        { actorId: "actor-1" },
        {
          ...deleteDependencies,
          findTarget: async (_db, messageId) => {
            calls.push(`find:${messageId}`);
            return target;
          },
          authorize: (input) => {
            calls.push(`authorize:${input.capability}:${input.actorId}`);
            expect(input.target).toEqual(target);
            return true;
          },
          deleteOwnMessage: async (_db, input) => {
            calls.push(`delete:${input.messageId}:${input.actorId}`);
            expect(input.target).toEqual(target);
            return deletedMessage;
          },
        },
      ),
    ).resolves.toEqual({
      status: "accepted",
      message: deletedMessage,
    });
    expect(calls).toEqual([
      "find:message-1",
      "authorize:message:delete_own:actor-1",
      "delete:message-1:actor-1",
    ]);
  });

  it("returns write_forbidden without persistence for missing or denied targets", async () => {
    let deleteCount = 0;
    const deleteOwnMessage = async () => {
      deleteCount += 1;
      return deletedMessage;
    };

    await expect(
      executeDeleteMessage(
        { messageId: "message-1" },
        { actorId: "actor-1" },
        {
          ...deleteDependencies,
          findTarget: async () => undefined,
          deleteOwnMessage,
        },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "write_forbidden" });
    await expect(
      executeDeleteMessage(
        { messageId: "message-1" },
        { actorId: "actor-1" },
        {
          ...deleteDependencies,
          authorize: () => false,
          deleteOwnMessage,
        },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "write_forbidden" });
    expect(deleteCount).toBe(0);
  });
});
