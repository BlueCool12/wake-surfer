import type { MarkReadCursorRequest } from '@wake-surfer/realtime-chat-contracts';
import {
  asRecord,
  invalid,
  positiveIntegerField,
  stringField,
  valid,
  type ValidationResult
} from './validation';

export function parseMarkReadCursorRequest(
  value: unknown
): ValidationResult<MarkReadCursorRequest> {
  const record = asRecord(value);

  if (!record) {
    return invalid('request body must be an object');
  }

  const requestId = stringField(record, 'requestId');
  const actorId = stringField(record, 'actorId');
  const streamId = stringField(record, 'streamId');
  const lastReadSequence = positiveIntegerField(record, 'lastReadSequence');

  if (!requestId || !actorId || !streamId || lastReadSequence === undefined) {
    return invalid('requestId, actorId, streamId, and lastReadSequence are required');
  }

  return valid({
    requestId,
    actorId,
    streamId,
    lastReadSequence
  });
}
