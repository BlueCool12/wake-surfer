import type { ApiErrorResponse } from "@wake-surfer/api-contracts";
import type { RealtimeChatErrorCode } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

export type GatewayTicketErrorResponse = ApiErrorResponse<RealtimeChatErrorCode>;

export type AppHttpError = Error & {
  readonly code: RealtimeChatErrorCode;
  readonly kind: "app_http_error";
  readonly statusCode: 400 | 401 | 403;
};

export type RequestDeadlineExceededError = Error & {
  readonly kind: "request_deadline_exceeded";
};

export function createAppHttpError(
  statusCode: AppHttpError["statusCode"],
  code: RealtimeChatErrorCode,
  message: string,
): AppHttpError {
  return Object.assign(new Error(message), {
    code,
    kind: "app_http_error" as const,
    statusCode,
  });
}

export function createGatewayTicketErrorResponse(
  code: RealtimeChatErrorCode,
  message: string,
): GatewayTicketErrorResponse {
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
  return error instanceof Error && "kind" in error && error.kind === "app_http_error";
}

export function isRequestDeadlineExceededError(
  error: unknown,
): error is RequestDeadlineExceededError {
  return error instanceof Error && "kind" in error && error.kind === "request_deadline_exceeded";
}
