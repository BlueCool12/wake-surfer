import type { IncomingMessage, ServerResponse } from "node:http";

import { pathnameFromRequest } from "../connection/upgrade-policy.js";

export function respondToHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  isClosing: boolean,
): void {
  const pathname = pathnameFromRequest(request);

  if (request.method === "GET" && pathname === "/health") {
    writeJson(response, isClosing ? 503 : 200, {
      status: isClosing ? "not_ready" : "ok",
    });
    return;
  }

  response.writeHead(pathname === null ? 400 : 404);
  response.end();
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}
