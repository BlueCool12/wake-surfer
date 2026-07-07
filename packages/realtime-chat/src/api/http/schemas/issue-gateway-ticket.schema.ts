import type { IssueGatewayTicketRequest } from "@wake-surfer/realtime-chat-contracts";
import { asRecord, invalid, valid, type ValidationResult } from "./validation";

export function parseIssueGatewayTicketRequest(
  value: unknown,
): ValidationResult<IssueGatewayTicketRequest> {
  if (value === undefined) {
    return valid({});
  }

  const record = asRecord(value);

  if (!record) {
    return invalid("request body must be an object when provided");
  }

  return valid({});
}
