import type {
  MarkReadCursorRequest,
  MarkReadCursorResponse,
  RealtimeChatErrorCode,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatApiRuntimeDeps } from "../runtime-deps";

export type MarkAsReadResult =
  | {
      status: "updated";
      response: MarkReadCursorResponse;
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export async function markAsRead(
  request: MarkReadCursorRequest,
  deps: RealtimeChatApiRuntimeDeps,
): Promise<MarkAsReadResult> {
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

  const cursor = await deps.db.markReadCursor({
    actorId: request.actorId,
    streamId: request.streamId,
    lastReadSequence: request.lastReadSequence,
    updatedAt: deps.clock.now().toISOString(),
  });

  return {
    status: "updated",
    response: {
      status: cursor.advanced ? "advanced" : "unchanged",
      commandId: request.requestId,
      streamId: cursor.streamId,
      lastReadSequence: cursor.lastReadSequence,
      updatedAt: cursor.updatedAt,
    },
  };
}
