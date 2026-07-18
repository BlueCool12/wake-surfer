import { createHash, timingSafeEqual } from "node:crypto";

import { AppHttpError } from "../app.js";

import type { AuthenticatedActor, AuthenticatedGateway } from "../app.js";
import type { RealtimeChatApiConfig } from "../config/env.js";

export type HeaderAuthContextConfig = Pick<
  RealtimeChatApiConfig,
  | "actorIdHeader"
  | "gatewayApiToken"
  | "gatewayAssertedActorHeader"
  | "gatewayId"
  | "gatewayIdHeader"
>;

export function createHeaderAuthContext(config: HeaderAuthContextConfig): {
  authenticateActor: (request: Request) => AuthenticatedActor;
  authenticateGateway: (request: Request) => AuthenticatedGateway;
  getAssertedActor: (request: Request) => AuthenticatedActor;
} {
  return {
    authenticateActor: (request) => {
      const actorId = readTrustedHeader(request, config.actorIdHeader);

      if (!actorId) {
        throw new AppHttpError(401, "unauthenticated", "authenticated actor context is required");
      }

      return {
        actorId,
      };
    },
    authenticateGateway: (request) => {
      const suppliedToken = readBearerToken(request);

      if (!isValidServiceToken(suppliedToken, config.gatewayApiToken)) {
        throw new AppHttpError(
          401,
          "unauthenticated",
          "authenticated gateway credential is required",
        );
      }

      const gatewayId = readTrustedHeader(request, config.gatewayIdHeader);

      if (!gatewayId) {
        throw new AppHttpError(401, "unauthenticated", "authenticated gateway context is required");
      }

      if (gatewayId !== config.gatewayId) {
        throw new AppHttpError(403, "forbidden", "gateway context is not allowed");
      }

      return {
        gatewayId: config.gatewayId,
      };
    },
    getAssertedActor: (request) => {
      const actorId = readTrustedHeader(request, config.gatewayAssertedActorHeader);

      if (!actorId) {
        throw new AppHttpError(
          401,
          "unauthenticated",
          "asserted gateway actor context is required",
        );
      }

      return { actorId };
    },
  };
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (authorization === null) {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

function isValidServiceToken(suppliedToken: string | null, expectedToken: string): boolean {
  const suppliedDigest = createHash("sha256")
    .update(suppliedToken ?? "")
    .digest();
  const expectedDigest = createHash("sha256").update(expectedToken).digest();

  return suppliedToken !== null && timingSafeEqual(suppliedDigest, expectedDigest);
}

function readTrustedHeader(request: Request, headerName: string): string | null {
  const value = request.headers.get(headerName)?.trim();
  return value || null;
}
