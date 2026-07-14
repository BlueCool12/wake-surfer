import type { MiddlewareHandler } from "hono";

import { createRequestDeadlineExceededError } from "./errors.js";

export type GatewayTicketDeadlineVariables = {
  gatewayTicketOperationSignal: AbortSignal;
};

export function gatewayTicketOperationDeadline(
  abortAfterMilliseconds: number,
): MiddlewareHandler<{ Variables: GatewayTicketDeadlineVariables }> {
  return async (context, next) => {
    const abortController = new AbortController();
    context.set("gatewayTicketOperationSignal", abortController.signal);
    const timer = setTimeout(() => {
      abortController.abort(createRequestDeadlineExceededError());
    }, abortAfterMilliseconds);
    timer.unref();

    try {
      await next();
    } finally {
      clearTimeout(timer);
    }
  };
}
