import type {
  RealtimeChatErrorCode,
  SyncStreamMessagesRequest,
  SyncStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatApiMountOptions } from "../http/mount";
import type { RealtimeChatApiRuntimeDeps } from "../runtime-deps";
import { toPublicMessageDto } from "../domain/message";

export type SyncStreamMessagesResult =
  | {
      status: "synced";
      response: SyncStreamMessagesResponse;
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export async function syncStreamMessages(
  request: SyncStreamMessagesRequest,
  deps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions,
): Promise<SyncStreamMessagesResult> {
  const permission = await deps.permissionPort.canReadStream({
    actorId: request.actorId,
    streamId: request.streamId,
  });

  if (!permission.allowed) {
    return {
      status: "rejected",
      reason: permission.reason,
      ...(permission.message ? { message: permission.message } : {}),
    };
  }

  const maxLimit = options.syncMaxLimit ?? 100;
  const requestedLimit = request.limit ?? options.syncDefaultLimit ?? 50;
  const limit = Math.min(Math.max(requestedLimit, 1), maxLimit);
  const result = await deps.db.listMessages({
    streamId: request.streamId,
    ...(request.afterSequence !== undefined ? { afterSequence: request.afterSequence } : {}),
    ...(request.beforeSequence !== undefined ? { beforeSequence: request.beforeSequence } : {}),
    limit,
  });

  return {
    status: "synced",
    response: {
      streamId: request.streamId,
      messages: result.messages.map(toPublicMessageDto),
      hasMoreBefore: result.hasMoreBefore,
      hasMoreAfter: result.hasMoreAfter,
    },
  };
}
