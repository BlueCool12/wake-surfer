import { describe, expect, it } from "vitest";

import {
  ConsumeGatewayTicketRequestBodySchema,
  IssueGatewayTicketRequestBodySchema,
} from "../src/index";

describe("issue gateway ticket request body schema", () => {
  it("accepts an empty object request body", () => {
    expect(IssueGatewayTicketRequestBodySchema.safeParse({}).success).toBe(true);
  });

  it("rejects actorId from the client request body", () => {
    expect(IssueGatewayTicketRequestBodySchema.safeParse({ actorId: "actor-1" }).success).toBe(
      false,
    );
  });

  it("rejects userId and workspaceId from the client request body", () => {
    expect(
      IssueGatewayTicketRequestBodySchema.safeParse({
        userId: "user-1",
        workspaceId: "workspace-1",
      }).success,
    ).toBe(false);
  });
});

describe("consume gateway ticket request body schema", () => {
  it("accepts a ticket-only request body", () => {
    expect(ConsumeGatewayTicketRequestBodySchema.safeParse({ ticket: "gt_ticket" })).toEqual({
      success: true,
      data: {
        ticket: "gt_ticket",
      },
    });
  });

  it("trims the ticket value", () => {
    expect(ConsumeGatewayTicketRequestBodySchema.safeParse({ ticket: "  gt_ticket  " })).toEqual({
      success: true,
      data: {
        ticket: "gt_ticket",
      },
    });
  });

  it("rejects gatewayId from the client request body", () => {
    expect(
      ConsumeGatewayTicketRequestBodySchema.safeParse({
        ticket: "gt_ticket",
        gatewayId: "gateway-1",
      }).success,
    ).toBe(false);
  });

  it("rejects a blank ticket", () => {
    expect(ConsumeGatewayTicketRequestBodySchema.safeParse({ ticket: " " }).success).toBe(false);
  });
});
