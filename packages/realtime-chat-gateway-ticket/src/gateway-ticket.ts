import type {
  ActorId,
  GatewayTicket,
  GatewayUrl,
  ISODateTime,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

export type GatewayId = string;
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

export type GatewayTicketPolicyConfig = {
  ttlMilliseconds: number;
  rawTicketBytes: number;
};

export function createGatewayTicketPolicy(config: GatewayTicketPolicyConfig): GatewayTicketPolicy {
  const policy = {
    ttlMilliseconds: config.ttlMilliseconds,
    rawTicketBytes: config.rawTicketBytes,
  };

  assertGatewayTicketPolicy(policy);

  return policy;
}

export function createGatewayTicketTimestamps(
  issuedAt: Date,
  policy: GatewayTicketPolicy,
): { issuedAt: ISODateTime; expiresAt: ISODateTime } {
  assertGatewayTicketPolicy(policy);

  return {
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + policy.ttlMilliseconds).toISOString(),
  };
}

export function assertGatewayTicketPolicy(policy: GatewayTicketPolicy): void {
  if (!Number.isInteger(policy.ttlMilliseconds) || policy.ttlMilliseconds <= 0) {
    throw new Error("게이트웨이 티켓 ttlMilliseconds는 양의 정수여야 합니다.");
  }

  if (!Number.isInteger(policy.rawTicketBytes) || policy.rawTicketBytes < 16) {
    throw new Error("게이트웨이 티켓 rawTicketBytes는 16 이상이어야 합니다.");
  }
}

export const defaultRawGatewayTicketGenerator: RawGatewayTicketGenerator = {
  generate(byteLength) {
    if (!globalThis.crypto?.getRandomValues) {
      throw new Error("게이트웨이 티켓을 생성하려면 crypto.getRandomValues가 필요합니다.");
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
      throw new Error("게이트웨이 티켓을 해시하려면 crypto.subtle이 필요합니다.");
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
