import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import { SendMessageResponseSchema } from "@wake-surfer/realtime-chat-message-send-contracts";
import {
  ChatStreamSyncedEventSchema,
  ChatStreamSyncRejectedEventSchema,
  ChatStreamSyncFailedEventSchema,
  type SyncAfterStreamMessagesRequest,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { RealtimeChatClientError } from "./realtime-chat-client-error.js";
import { assertMessageTarget, parse, record, validatePage, type Schema } from "./protocol.js";
import type { ChatTarget } from "./types.js";

export function sendResponse(target: ChatTarget, actorId: string, key: string) {
  return (event: string, payload: unknown) => {
    if (
      !record(payload) ||
      payload.idempotencyKey !== key ||
      !["chat.message.accepted", "chat.message.rejected"].includes(event)
    )
      return;
    const response = parse(SendMessageResponseSchema, payload);
    if (event !== "chat.message." + response.status)
      throw new RealtimeChatClientError("protocol_failure");
    if (response.status === "accepted") {
      assertMessageTarget(target, response.message);
      if (response.message.senderActorId !== actorId)
        throw new RealtimeChatClientError("protocol_failure");
    }
    return response;
  };
}

type MutationResponse = {
  status: "accepted" | "rejected";
  message?: Pick<PublicMessage, "messageId" | "streamId" | "target">;
};
export function mutationResponse<T extends MutationResponse>(
  target: ChatTarget,
  kind: "edit" | "delete",
  messageId: string,
  schema: Schema<T>,
) {
  return (event: string, payload: unknown): T | undefined => {
    const prefix = "chat.message." + kind + ".";
    if (event !== prefix + "accepted" && event !== prefix + "rejected") return;
    const response = parse(schema, payload);
    if (event !== prefix + response.status) throw new RealtimeChatClientError("protocol_failure");
    if (response.message !== undefined) {
      if (response.message.messageId !== messageId) return;
      assertMessageTarget(target, response.message);
    }
    return response;
  };
}

export function syncResponse(
  target: ChatTarget,
  input: SyncAfterStreamMessagesRequest,
  requestId: string,
) {
  return (event: string, payload: unknown) => {
    if (!record(payload) || payload.requestId !== requestId) return;
    if (event === "chat.stream.synced") {
      const { requestId: ignored, ...response } = parse(ChatStreamSyncedEventSchema, payload);
      void ignored;
      if (
        response.afterSequence !== input.afterSequence ||
        (input.throughSequence !== undefined && response.throughSequence !== input.throughSequence)
      ) {
        throw new RealtimeChatClientError("protocol_failure");
      }
      return validatePage(target, response);
    }
    if (event === "chat.stream.sync.rejected") {
      const response = parse(ChatStreamSyncRejectedEventSchema, payload);
      throw new RealtimeChatClientError(response.code, {
        ...(response.code === "rate_limited" ? { retryAfterMs: response.retryAfterMs } : {}),
      });
    }
    if (event === "chat.stream.sync.failed") {
      const response = parse(ChatStreamSyncFailedEventSchema, payload);
      throw new RealtimeChatClientError(response.code, { retryable: response.retryable });
    }
  };
}
