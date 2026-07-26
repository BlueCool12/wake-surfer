import type { IncomingMessage, ServerResponse } from "node:http";

import { pathnameFromRequest } from "../connection/upgrade-policy.js";

export function respondToHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  isDraining: boolean,
): void {
  const pathname = pathnameFromRequest(request);

  if (request.method === "GET" && pathname === "/health") {
    writeJson(response, 200, {
      status: "ok",
    });
    return;
  }

  if (request.method === "GET" && pathname === "/health/live") {
    writeJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && pathname === "/health/ready") {
    writeJson(response, isDraining ? 503 : 200, {
      status: isDraining ? "not_ready" : "ready",
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
