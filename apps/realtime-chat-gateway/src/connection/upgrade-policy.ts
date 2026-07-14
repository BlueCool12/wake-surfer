import type { IncomingMessage } from "node:http";

export type UpgradePolicyInput = {
  allowedOrigins: string[];
  clientCount: number;
  gatewayPath: string;
  isDraining: boolean;
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
  if (input.isDraining) {
    return { reason: "Service Unavailable", status: 503 };
  }

  const pathname = pathnameFromRequest(request);

  if (pathname === null) {
    return { reason: "Bad Request", status: 400 };
  }

  if (pathname !== input.gatewayPath) {
    return { reason: "Not Found", status: 404 };
  }

  if (!isAllowedOrigin(request, input.allowedOrigins)) {
    return { reason: "Forbidden", status: 403 };
  }

  if (input.clientCount >= input.maxConnections) {
    return { reason: "Service Unavailable", status: 503 };
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

function isAllowedOrigin(request: IncomingMessage, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    return true;
  }

  const origin = request.headers.origin?.trim();
  return origin !== undefined && allowedOrigins.includes(origin);
}
