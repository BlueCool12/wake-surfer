import type { ApiCommonErrorCode, ApiErrorResponse } from "@wake-surfer/api-contracts";
import type { RealtimeChatErrorCode } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

export type RealtimeChatApiErrorCode = RealtimeChatErrorCode | ApiCommonErrorCode;
export type RealtimeChatApiErrorResponse = ApiErrorResponse<RealtimeChatApiErrorCode>;

export class AppHttpError extends Error {
  readonly code: RealtimeChatApiErrorCode;
  readonly statusCode: 400 | 401 | 403 | 404 | 500 | 503;

  constructor(
    statusCode: AppHttpError["statusCode"],
    code: RealtimeChatApiErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppHttpError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type RequestDeadlineExceededError = Error & {
  readonly kind: "request_deadline_exceeded";
};

export function createApiErrorResponse(
  code: RealtimeChatApiErrorCode,
  message: string,
): RealtimeChatApiErrorResponse {
  return {
    code,
    message,
    status: "error",
  };
}

export function createRequestDeadlineExceededError(): RequestDeadlineExceededError {
  return Object.assign(new Error("gateway ticket request timed out"), {
    kind: "request_deadline_exceeded" as const,
  });
}

export function isAppHttpError(error: unknown): error is AppHttpError {
  return error instanceof AppHttpError;
}

export function isRequestDeadlineExceededError(
  error: unknown,
): error is RequestDeadlineExceededError {
  return error instanceof Error && "kind" in error && error.kind === "request_deadline_exceeded";
}
