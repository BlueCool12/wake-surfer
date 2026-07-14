import { describe, expect, it } from "vitest";

import { ConsumeGatewayTicketResponseSchema } from "../src";

describe("gateway ticket response contracts", () => {
  it("accepts a consumed response with a non-blank actor and ISO timestamp", () => {
    expect(
      ConsumeGatewayTicketResponseSchema.safeParse({
        status: "consumed",
        ticket: {
          actorId: "actor-1",
          consumedAt: "2026-07-09T00:00:10.000Z",
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      status: "consumed",
      ticket: { actorId: " ", consumedAt: "2026-07-09T00:00:10.000Z" },
    },
    {
      status: "consumed",
      ticket: { actorId: "actor-1", consumedAt: "not-a-date" },
    },
    {
      status: "rejected",
      reason: "database_unavailable",
    },
  ])("rejects an invalid response: %j", (response) => {
    expect(ConsumeGatewayTicketResponseSchema.safeParse(response).success).toBe(false);
  });
});
