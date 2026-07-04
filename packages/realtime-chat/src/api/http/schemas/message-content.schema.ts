import type { TextMessageContentDto } from '@wake-surfer/realtime-chat-contracts';
import { asRecord, invalid, stringField, valid, type ValidationResult } from './validation';

export function parseTextMessageContent(
  value: unknown
): ValidationResult<TextMessageContentDto> {
  const record = asRecord(value);

  if (!record) {
    return invalid('content must be an object');
  }

  const kind = stringField(record, 'kind');
  const text = stringField(record, 'text');

  if (kind !== 'text') {
    return invalid('content.kind must be text');
  }

  if (!text) {
    return invalid('content.text is required');
  }

  return valid({
    kind: 'text',
    text
  });
}
