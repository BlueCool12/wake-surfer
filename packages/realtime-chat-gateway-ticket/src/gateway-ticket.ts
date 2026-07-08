import type {
  ActorId,
  GatewayId,
  GatewayTicket,
  GatewayUrl,
  ISODateTime,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

export type GatewayTicketHash = string;

export type GatewayAssignment = {
  gatewayId: GatewayId;
  gatewayUrl: GatewayUrl;
};

export type GatewayTicketPolicy = {
  ttlMilliseconds: number;
  rawTicketBytes: number;
};

export type IssuedGatewayTicket = {
  ticketHash: GatewayTicketHash;
  actorId: ActorId;
  assignedGatewayId: GatewayId;
  issuedAt: ISODateTime;
  expiresAt: ISODateTime;
};

export type GatewayTicketConsumptionInput = {
  ticketHash: GatewayTicketHash;
  gatewayId: GatewayId;
  now: ISODateTime;
  consumedAt: ISODateTime;
};

export type GatewayTicketConsumptionResult =
  | {
      status: "consumed";
      ticket: {
        actorId: ActorId;
        consumedAt: ISODateTime;
      };
    }
  | {
      status: "rejected";
      reason: "not_consumable";
    };

export type RawGatewayTicketGenerator = {
  generate: (byteLength: number) => GatewayTicket;
};

export type TicketHasher = {
  hash: (ticket: GatewayTicket) => GatewayTicketHash | Promise<GatewayTicketHash>;
};

export const defaultGatewayTicketPolicy: GatewayTicketPolicy = {
  ttlMilliseconds: 60_000,
  rawTicketBytes: 32,
};

export function createGatewayTicketTimestamps(
  issuedAt: Date,
  policy: GatewayTicketPolicy = defaultGatewayTicketPolicy,
): { issuedAt: ISODateTime; expiresAt: ISODateTime } {
  assertGatewayTicketPolicy(policy);

  return {
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + policy.ttlMilliseconds).toISOString(),
  };
}

export function assertGatewayTicketPolicy(policy: GatewayTicketPolicy): void {
  if (!Number.isInteger(policy.ttlMilliseconds) || policy.ttlMilliseconds <= 0) {
    throw new Error("gateway ticket ttlMilliseconds must be a positive integer");
  }

  if (!Number.isInteger(policy.rawTicketBytes) || policy.rawTicketBytes < 16) {
    throw new Error("gateway ticket rawTicketBytes must be at least 16");
  }
}

export const defaultRawGatewayTicketGenerator: RawGatewayTicketGenerator = {
  generate(byteLength) {
    if (!globalThis.crypto?.getRandomValues) {
      throw new Error("crypto.getRandomValues is required to generate gateway tickets");
    }

    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);

    let token = "";

    for (const byte of bytes) {
      token += byte.toString(16).padStart(2, "0");
    }

    return `gt_${token}`;
  },
};

export const defaultTicketHasher: TicketHasher = {
  async hash(ticket) {
    if (!globalThis.crypto?.subtle) {
      throw new Error("crypto.subtle is required to hash gateway tickets");
    }

    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(ticket),
    );
    const bytes = new Uint8Array(digest);
    let hash = "";

    for (const byte of bytes) {
      hash += byte.toString(16).padStart(2, "0");
    }

    return `sha256:${hash}`;
  },
};
