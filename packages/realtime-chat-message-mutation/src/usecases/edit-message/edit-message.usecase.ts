import type { EditMessageRequest } from "@wake-surfer/realtime-chat-message-mutation-contracts";
import type { MessageTarget } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";
import {
  assertActorId,
  assertMessageId,
  isDeletedMessage,
  normalizeEditedMessageText,
  type DeletedMessage,
  type EditedTextMessage,
  type EditMessageResult,
  type MessageMutationAuthorizer,
  type MessageMutationContext,
} from "../../message-mutation";
import type { MessageMutationDatabase } from "../../message-mutation-table";
import { editOwnMessage, findEditMessageTarget } from "./edit-message.kysely";

export type EditMessage = (
  request: EditMessageRequest,
  context: MessageMutationContext,
) => Promise<EditMessageResult>;

export type EditMessageDependencies<DB extends MessageMutationDatabase = MessageMutationDatabase> =
  {
    db: Kysely<DB>;
    authorize: MessageMutationAuthorizer;
  };

export type EditMessageExecutionDependencies = {
  db: Kysely<MessageMutationDatabase>;
  authorize: MessageMutationAuthorizer;
  findTarget: typeof findEditMessageTarget;
  editOwnMessage: (
    db: Kysely<MessageMutationDatabase>,
    input: {
      messageId: string;
      actorId: string;
      target: MessageTarget;
      text: string;
    },
  ) => Promise<EditedTextMessage | DeletedMessage | undefined>;
};

export function createEditMessage<DB extends MessageMutationDatabase>(
  dependencies: EditMessageDependencies<DB>,
): EditMessage {
  const db = dependencies.db as Kysely<MessageMutationDatabase>;

  return (request, context) =>
    executeEditMessage(request, context, {
      db,
      authorize: dependencies.authorize,
      findTarget: findEditMessageTarget,
      editOwnMessage,
    });
}

export async function executeEditMessage(
  request: EditMessageRequest,
  context: MessageMutationContext,
  dependencies: EditMessageExecutionDependencies,
): Promise<EditMessageResult> {
  assertActorId(context.actorId);
  assertMessageId(request.messageId);

  const text = normalizeEditedMessageText(request.text);

  if (text === undefined) {
    return {
      status: "rejected",
      reason: "invalid_content",
    };
  }

  const target = await dependencies.findTarget(dependencies.db, request.messageId);

  if (target === undefined) {
    return writeForbidden();
  }

  const allowed = await dependencies.authorize({
    actorId: context.actorId,
    target,
    capability: "message:edit_own",
  });

  if (!allowed) {
    return writeForbidden();
  }

  const message = await dependencies.editOwnMessage(dependencies.db, {
    messageId: request.messageId,
    actorId: context.actorId,
    target,
    text,
  });

  if (message === undefined) {
    return writeForbidden();
  }

  if (isDeletedMessage(message)) {
    return {
      status: "rejected",
      reason: "message_deleted",
      message,
    };
  }

  return {
    status: "accepted",
    message,
  };
}

function writeForbidden(): EditMessageResult {
  return {
    status: "rejected",
    reason: "write_forbidden",
  };
}
