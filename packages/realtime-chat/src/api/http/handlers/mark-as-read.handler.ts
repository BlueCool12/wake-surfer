import type { RealtimeChatUsecases } from "../../application/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { badRequest, forbidden, ok } from "./response";
import { parseMarkReadCursorRequest } from "../schemas/read-cursor.schema";

export function createMarkAsReadHandler(usecases: RealtimeChatUsecases): HttpRouteHandler {
  return async (request) => {
    const parsed = parseMarkReadCursorRequest(request.body);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    const result = await usecases.markAsRead(parsed.value);

    if (result.status === "rejected") {
      return forbidden(result.reason, result.message);
    }

    return ok(result.response);
  };
}
