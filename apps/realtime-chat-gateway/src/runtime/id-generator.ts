import { randomUUID } from 'node:crypto';
import type { IdGeneratorPort } from '@wake-surfer/realtime-chat/gateway';

export function createNodeIdGenerator(): IdGeneratorPort {
  return {
    generateId(scope) {
      return `${scope}_${randomUUID()}`;
    }
  };
}
