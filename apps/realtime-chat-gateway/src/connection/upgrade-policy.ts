import type { IncomingMessage } from "node:http";

export type UpgradePolicyInput = {
  allowedOrigins: string[];
  clientCount: number;
  gatewayPath: string;
  isClosing: boolean;
  maxConnections: number;
};

export type UpgradeRejection = {
  reason: string;
  status: 400 | 403 | 404 | 503;
};

export function evaluateUpgrade(
  request: IncomingMessage,
  input: UpgradePolicyInput,
): UpgradeRejection | null {
  if (input.isClosing) {
    return { reason: "Service Unavailable", status: 503 };
  }

  if (input.clientCount >= input.maxConnections) {
    return { reason: "Service Unavailable", status: 503 };
  }

  const pathname = pathnameFromRequest(request);

  if (pathname === null) {
    return { reason: "Bad Request", status: 400 };
  }

  if (pathname !== input.gatewayPath) {
    return { reason: "Not Found", status: 404 };
  }

  const origin = request.headers.origin?.trim();

  if (origin === undefined || !input.allowedOrigins.includes(origin)) {
    return { reason: "Forbidden", status: 403 };
  }

  return null;
}

export function pathnameFromRequest(request: IncomingMessage): string | null {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}
