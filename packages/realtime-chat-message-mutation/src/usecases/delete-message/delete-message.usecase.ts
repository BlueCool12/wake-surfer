import type { DeleteMessageRequest } from "@wake-surfer/realtime-chat-message-mutation-contracts";
import type { MessageTarget } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";
import {
  assertActorId,
  assertMessageId,
  type DeletedMessage,
  type DeleteMessageResult,
  type MessageMutationAuthorizer,
  type MessageMutationContext,
} from "../../message-mutation";
import type { MessageMutationDatabase } from "../../message-mutation-table";
import { deleteOwnMessage, findDeleteMessageTarget } from "./delete-message.kysely";

export type DeleteMessage = (
  request: DeleteMessageRequest,
  context: MessageMutationContext,
) => Promise<DeleteMessageResult>;

export type DeleteMessageDependencies<
  DB extends MessageMutationDatabase = MessageMutationDatabase,
> = {
  db: Kysely<DB>;
  authorize: MessageMutationAuthorizer;
};

export type DeleteMessageExecutionDependencies = {
  db: Kysely<MessageMutationDatabase>;
  authorize: MessageMutationAuthorizer;
  findTarget: typeof findDeleteMessageTarget;
  deleteOwnMessage: (
    db: Kysely<MessageMutationDatabase>,
    input: {
      messageId: string;
      actorId: string;
      target: MessageTarget;
    },
  ) => Promise<DeletedMessage | undefined>;
};

export function createDeleteMessage<DB extends MessageMutationDatabase>(
  dependencies: DeleteMessageDependencies<DB>,
): DeleteMessage {
  const db = dependencies.db as Kysely<MessageMutationDatabase>;

  return (request, context) =>
    executeDeleteMessage(request, context, {
      db,
      authorize: dependencies.authorize,
      findTarget: findDeleteMessageTarget,
      deleteOwnMessage,
    });
}

export async function executeDeleteMessage(
  request: DeleteMessageRequest,
  context: MessageMutationContext,
  dependencies: DeleteMessageExecutionDependencies,
): Promise<DeleteMessageResult> {
  assertActorId(context.actorId);
  assertMessageId(request.messageId);

  const target = await dependencies.findTarget(dependencies.db, request.messageId);

  if (target === undefined) {
    return writeForbidden();
  }

  const allowed = await dependencies.authorize({
    actorId: context.actorId,
    target,
    capability: "message:delete_own",
  });

  if (!allowed) {
    return writeForbidden();
  }

  const message = await dependencies.deleteOwnMessage(dependencies.db, {
    messageId: request.messageId,
    actorId: context.actorId,
    target,
  });

  if (message === undefined) {
    return writeForbidden();
  }

  return {
    status: "accepted",
    message,
  };
}

function writeForbidden(): DeleteMessageResult {
  return {
    status: "rejected",
    reason: "write_forbidden",
  };
}
