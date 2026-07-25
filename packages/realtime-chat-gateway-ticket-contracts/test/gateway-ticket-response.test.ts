import { describe, expect, it } from "vitest";

import { ConsumeGatewayTicketResponseSchema } from "../src/index";

describe("ConsumeGatewayTicketResponseSchema", () => {
  it("accepts a consumed ticket response", () => {
    expect(
      ConsumeGatewayTicketResponseSchema.parse({
        status: "consumed",
        ticket: {
          actorId: "actor-1",
          consumedAt: "2026-07-25T06:00:00.000Z",
        },
      }),
    ).toEqual({
      status: "consumed",
      ticket: {
        actorId: "actor-1",
        consumedAt: "2026-07-25T06:00:00.000Z",
      },
    });
  });

  it("rejects unknown response fields", () => {
    expect(
      ConsumeGatewayTicketResponseSchema.safeParse({
        status: "rejected",
        reason: "invalid_or_expired",
        actorId: "spoofed",
      }).success,
    ).toBe(false);
  });
});
