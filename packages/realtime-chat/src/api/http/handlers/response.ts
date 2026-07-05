import type { HttpResponseLike } from "../http-server-like";
import type { RealtimeChatErrorCode } from "@wake-surfer/realtime-chat-contracts";

export function ok(body: unknown): HttpResponseLike {
  return {
    status: 200,
    body,
  };
}

export function created(body: unknown): HttpResponseLike {
  return {
    status: 201,
    body,
  };
}

export function badRequest(message: string): HttpResponseLike {
  return errorResponse(400, "INVALID_PAYLOAD", message);
}

export function forbidden(reason: RealtimeChatErrorCode, message?: string): HttpResponseLike {
  return errorResponse(403, reason, message);
}

export function errorResponse(
  status: number,
  reason: RealtimeChatErrorCode,
  message?: string,
): HttpResponseLike {
  return {
    status,
    body: {
      reason,
      ...(message ? { message } : {}),
    },
  };
}
