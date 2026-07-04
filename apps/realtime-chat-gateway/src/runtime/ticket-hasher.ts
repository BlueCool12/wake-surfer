import { createHash } from 'node:crypto';

export type GatewayTicketHasher = {
  hash: (ticketValue: string) => string;
};

export function createNodeGatewayTicketHasher(): GatewayTicketHasher {
  return {
    hash(ticketValue) {
      return `sha256:${createHash('sha256').update(ticketValue).digest('hex')}`;
    }
  };
}
