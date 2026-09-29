import { RealtimeChatClientError } from "./realtime-chat-client-error.js";

export function clientError(error: unknown): RealtimeChatClientError {
  return error instanceof RealtimeChatClientError
    ? error
    : new RealtimeChatClientError("protocol_failure", { cause: error });
}

export function abortError(signal: AbortSignal): RealtimeChatClientError {
  return signal.reason instanceof RealtimeChatClientError
    ? signal.reason
    : new RealtimeChatClientError("cancelled");
}

export function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

export function writeError(error: unknown): RealtimeChatClientError {
  const failure = clientError(error);
  return ["timeout", "socket_closed"].includes(failure.code)
    ? new RealtimeChatClientError("confirmation_unavailable", { cause: failure })
    : failure;
}

export function serverError(value: {
  code: string;
  retryable?: boolean;
  retryAfterMs?: number;
}): RealtimeChatClientError {
  return new RealtimeChatClientError(value.code, {
    ...(value.retryable === undefined ? {} : { retryable: value.retryable }),
    ...(value.retryAfterMs === undefined ? {} : { retryAfterMs: value.retryAfterMs }),
  });
}
