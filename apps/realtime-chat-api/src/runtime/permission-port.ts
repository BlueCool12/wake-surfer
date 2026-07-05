import type { PermissionPort } from "@wake-surfer/realtime-chat/api";

export function createAllowAllPermissionPort(): PermissionPort {
  return {
    async canIssueGatewayTicket() {
      return {
        allowed: true,
      };
    },
    async canWriteMessage() {
      return {
        allowed: true,
      };
    },
    async canReadStream() {
      return {
        allowed: true,
      };
    },
    async resolveMessageRecipients(input) {
      return input.actorId ? [input.actorId] : [];
    },
  };
}
