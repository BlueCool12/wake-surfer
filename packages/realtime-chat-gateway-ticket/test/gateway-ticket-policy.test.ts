import { describe, expect, it } from "vitest";
import {
  assertGatewayTicketPolicy,
  createGatewayTicketPolicy,
  createGatewayTicketTimestamps,
} from "../src/gateway-ticket";

describe("gateway ticket policy", () => {
  it("creates a policy with ttl and raw ticket byte settings", () => {
    const policy = createGatewayTicketPolicy({
      ttlMilliseconds: 60_000,
      rawTicketBytes: 32,
    });

    expect(policy).toEqual({
      ttlMilliseconds: 60_000,
      rawTicketBytes: 32,
    });
  });

  it("rejects non-positive ttl milliseconds", () => {
    expect(() =>
      createGatewayTicketPolicy({
        ttlMilliseconds: 0,
        rawTicketBytes: 32,
      }),
    ).toThrow("ttlMilliseconds");
  });

  it("rejects non-integer ttl milliseconds", () => {
    expect(() =>
      createGatewayTicketPolicy({
        ttlMilliseconds: 1.5,
        rawTicketBytes: 32,
      }),
    ).toThrow("ttlMilliseconds");
  });

  it("rejects raw ticket byte length below the minimum", () => {
    expect(() =>
      createGatewayTicketPolicy({
        ttlMilliseconds: 60_000,
        rawTicketBytes: 15,
      }),
    ).toThrow("rawTicketBytes");
  });

  it("accepts the minimum raw ticket byte length", () => {
    expect(() =>
      assertGatewayTicketPolicy({
        ttlMilliseconds: 60_000,
        rawTicketBytes: 16,
      }),
    ).not.toThrow();
  });

  it("calculates issued and expiration timestamps from ttl", () => {
    const issuedAt = new Date("2026-07-09T00:00:00.000Z");
    const timestamps = createGatewayTicketTimestamps(
      issuedAt,
      createGatewayTicketPolicy({
        ttlMilliseconds: 90_000,
        rawTicketBytes: 32,
      }),
    );

    expect(timestamps).toEqual({
      issuedAt: "2026-07-09T00:00:00.000Z",
      expiresAt: "2026-07-09T00:01:30.000Z",
    });
  });
});
