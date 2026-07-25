import { randomUUID } from "node:crypto";

import {
  RequestIdSchema,
  type StreamMessagesHttpErrorResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { createMiddleware } from "hono/factory";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export const streamMessagesRequestId = createMiddleware(async (context, next) => {
  const supplied = context.req.header("x-request-id");
  const parsed = supplied === undefined ? undefined : RequestIdSchema.safeParse(supplied);

  if (parsed !== undefined && !parsed.success) {
    return context.json(
      {
        status: "error",
        code: "bad_request",
        message: "x-request-id가 올바르지 않습니다.",
      } satisfies StreamMessagesHttpErrorResponse,
      400,
    );
  }

  const requestId = parsed?.data ?? randomUUID();
  context.set("requestId", requestId);
  await next();
  context.res.headers.set("x-request-id", requestId);
});
