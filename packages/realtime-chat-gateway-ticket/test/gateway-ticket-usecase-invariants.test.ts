import { describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { GatewayTicketDatabase } from "../src/gateway-ticket-table";
import {
  consumeGatewayTicket,
  type ConsumeGatewayTicketDeps,
} from "../src/usecases/consume-gateway-ticket/consume-gateway-ticket.usecase";
import {
  createStaticGatewayAssigner,
  issueGatewayTicket,
  type IssueGatewayTicketDeps,
} from "../src/usecases/issue-gateway-ticket/issue-gateway-ticket.usecase";

const db = {} as Kysely<GatewayTicketDatabase>;

const issueDeps: IssueGatewayTicketDeps = {
  db,
  now: () => new Date("2026-07-09T00:00:00.000Z"),
  assignGateway: () => ({
    gatewayId: "gateway-a",
    gatewayUrl: "wss://gateway.example.com/realtime-chat",
  }),
  ticketPolicy: {
    ttlMilliseconds: 60_000,
    rawTicketBytes: 32,
  },
};

const consumeDeps: ConsumeGatewayTicketDeps = {
  db,
  now: () => new Date("2026-07-09T00:00:00.000Z"),
};

const consumeDepsWithFailingHasher: ConsumeGatewayTicketDeps = {
  ...consumeDeps,
  ticketHasher: {
    hash() {
      throw new Error("빈 티켓은 해시하지 않아야 합니다.");
    },
  },
};

describe("gateway ticket usecase invariants", () => {
  it("rejects a blank actorId before issuing a ticket", async () => {
    await expect(
      issueGatewayTicket(
        {
          actorId: " ",
        },
        issueDeps,
      ),
    ).rejects.toThrow("actorId");
  });

  it("rejects an invalid gateway assignment returned by the assigner", async () => {
    await expect(
      issueGatewayTicket(
        {
          actorId: "actor-1",
        },
        {
          ...issueDeps,
          assignGateway: () => ({
            gatewayId: "gateway-a",
            gatewayUrl: "https://gateway.example.com/realtime-chat",
          }),
        },
      ),
    ).rejects.toThrow("프로토콜");
  });

  it("rejects invalid static gateway assigner configuration at setup time", () => {
    expect(() =>
      createStaticGatewayAssigner({
        gatewayId: "gateway-a",
        gatewayUrl: "https://gateway.example.com/realtime-chat",
      }),
    ).toThrow("프로토콜");
  });

  it("rejects a blank gatewayId before consuming a ticket", async () => {
    await expect(
      consumeGatewayTicket(
        {
          ticket: "gt_ticket",
        },
        {
          gatewayId: " ",
        },
        consumeDeps,
      ),
    ).rejects.toThrow("gatewayId");
  });

  it("returns rejected for a blank ticket without hashing it", async () => {
    await expect(
      consumeGatewayTicket(
        {
          ticket: " ",
        },
        {
          gatewayId: "gateway-a",
        },
        consumeDepsWithFailingHasher,
      ),
    ).resolves.toEqual({
      status: "rejected",
      reason: "invalid_or_expired",
    });
  });
});
