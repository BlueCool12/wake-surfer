import type { ConsumeGatewayTicketRequest } from "@wake-surfer/realtime-chat-contracts";
import { asRecord, invalid, stringField, valid, type ValidationResult } from "./validation";

export function parseConsumeGatewayTicketRequest(
  body: unknown,
): ValidationResult<ConsumeGatewayTicketRequest> {
  const record = asRecord(body);

  if (!record) {
    return invalid("body must be an object");
  }

  const ticket = stringField(record, "ticket");

  if (!ticket) {
    return invalid("ticket is required");
  }

  return valid({
    ticket,
  });
}
