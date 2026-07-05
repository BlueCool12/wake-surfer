import type { SyncStreamMessagesRequest } from "@wake-surfer/realtime-chat-contracts";
import { invalid, nonNegativeIntegerFromString, valid, type ValidationResult } from "./validation";

export function parseSyncStreamMessagesRequest(
  params: Record<string, string | undefined>,
  query: Record<string, string | undefined>,
): ValidationResult<SyncStreamMessagesRequest> {
  const requestId = query["requestId"];
  const actorId = query["actorId"];
  const streamId = params["streamId"];
  const afterSequence = nonNegativeIntegerFromString(query["afterSequence"]);
  const beforeSequence = nonNegativeIntegerFromString(query["beforeSequence"]);
  const limit = nonNegativeIntegerFromString(query["limit"]);

  if (!requestId || !actorId || !streamId) {
    return invalid("requestId, actorId, and streamId are required");
  }

  return valid({
    requestId,
    actorId,
    streamId,
    ...(afterSequence !== undefined ? { afterSequence } : {}),
    ...(beforeSequence !== undefined ? { beforeSequence } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
}
