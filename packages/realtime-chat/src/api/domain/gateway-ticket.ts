import type { TicketHasherPort } from '../runtime-deps';

export const defaultTicketHasher: TicketHasherPort = {
  async hash(ticketValue: string): Promise<string> {
    const cryptoApi = globalThis.crypto;

    if (cryptoApi?.subtle) {
      const digest = await cryptoApi.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(ticketValue)
      );
      const bytes = new Uint8Array(digest);
      let hex = '';

      for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0');
      }

      return `sha256:${hex}`;
    }

    let hash = 2166136261;

    for (let index = 0; index < ticketValue.length; index += 1) {
      hash ^= ticketValue.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `fnv1a:${(hash >>> 0).toString(16)}`;
  }
};
