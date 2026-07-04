import type { IssueGatewayTicketRequest } from '@wake-surfer/realtime-chat-contracts';
import {
  asRecord,
  invalid,
  optionalStringField,
  positiveIntegerField,
  stringField,
  valid,
  type ValidationResult
} from './validation';

export function parseIssueGatewayTicketRequest(
  value: unknown,
  fallbackActorId: string | undefined
): ValidationResult<IssueGatewayTicketRequest> {
  const record = asRecord(value);

  if (!record) {
    return invalid('request body must be an object');
  }

  const actorId = stringField(record, 'actorId') ?? fallbackActorId;

  if (!actorId) {
    return invalid('actorId is required');
  }

  const workspaceId = optionalStringField(record, 'workspaceId');
  const gatewayUrl = optionalStringField(record, 'gatewayUrl');
  const ttlSeconds = positiveIntegerField(record, 'ttlSeconds');

  return valid({
    actorId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(gatewayUrl ? { gatewayUrl } : {}),
    ...(ttlSeconds ? { ttlSeconds } : {})
  });
}
