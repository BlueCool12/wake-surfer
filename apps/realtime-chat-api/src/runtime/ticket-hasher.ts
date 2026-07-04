import { createHash } from 'node:crypto';
import type { TicketHasherPort } from '@wake-surfer/realtime-chat/api';

export function createNodeGatewayTicketHasher(): TicketHasherPort {
  return {
    hash(ticketValue) {
      return `sha256:${createHash('sha256').update(ticketValue).digest('hex')}`;
    }
  };
}
