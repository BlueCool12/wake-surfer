import { describe, expect, it } from "vitest";
import { parseConsumeGatewayTicketRequestBody } from "../src/usecases/consume-gateway-ticket/consume-gateway-ticket.schema";
import { parseIssueGatewayTicketRequestBody } from "../src/usecases/issue-gateway-ticket/issue-gateway-ticket.schema";

describe("issue gateway ticket request body parser", () => {
  it("accepts an omitted request body", () => {
    expect(parseIssueGatewayTicketRequestBody(undefined)).toEqual({
      ok: true,
    });
  });

  it("accepts an empty object request body", () => {
    expect(parseIssueGatewayTicketRequestBody({})).toEqual({
      ok: true,
    });
  });

  it("rejects actorId from the client request body", () => {
    expect(parseIssueGatewayTicketRequestBody({ actorId: "actor-1" })).toEqual({
      ok: false,
      message:
        "게이트웨이 티켓 발급 요청 본문에는 클라이언트가 소유한 actor 또는 workspace 필드를 포함할 수 없습니다.",
    });
  });

  it("rejects userId and workspaceId from the client request body", () => {
    expect(
      parseIssueGatewayTicketRequestBody({
        userId: "user-1",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      ok: false,
      message:
        "게이트웨이 티켓 발급 요청 본문에는 클라이언트가 소유한 actor 또는 workspace 필드를 포함할 수 없습니다.",
    });
  });
});

describe("consume gateway ticket request body parser", () => {
  it("accepts a ticket-only request body", () => {
    expect(parseConsumeGatewayTicketRequestBody({ ticket: "gt_ticket" })).toEqual({
      ok: true,
      value: {
        ticket: "gt_ticket",
      },
    });
  });

  it("trims the ticket value", () => {
    expect(parseConsumeGatewayTicketRequestBody({ ticket: "  gt_ticket  " })).toEqual({
      ok: true,
      value: {
        ticket: "gt_ticket",
      },
    });
  });

  it("rejects gatewayId from the client request body", () => {
    expect(
      parseConsumeGatewayTicketRequestBody({
        ticket: "gt_ticket",
        gatewayId: "gateway-1",
      }),
    ).toEqual({
      ok: false,
      message: "게이트웨이 티켓 소비 요청 본문이 올바르지 않습니다.",
    });
  });

  it("rejects a blank ticket", () => {
    expect(parseConsumeGatewayTicketRequestBody({ ticket: " " })).toEqual({
      ok: false,
      message: "게이트웨이 티켓 소비 요청 본문이 올바르지 않습니다.",
    });
  });
});
