import { AppHttpError } from "../app.js";

import type { AuthenticatedActor, AuthenticatedGateway } from "../app.js";
import type { RealtimeChatApiConfig } from "../config/env.js";

export type HeaderAuthContextConfig = Pick<
  RealtimeChatApiConfig,
  "actorIdHeader" | "gatewayAssertedActorHeader" | "gatewayId" | "gatewayIdHeader"
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

function readTrustedHeader(request: Request, headerName: string): string | null {
  const value = request.headers.get(headerName)?.trim();
  return value || null;
}
