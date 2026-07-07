import type { GatewayAssignmentPort } from "@wake-surfer/realtime-chat/api";

export function createStaticGatewayAssignmentPort(input: {
  gatewayId: string;
  gatewayUrl: string;
}): GatewayAssignmentPort {
  const gatewayId = input.gatewayId.trim();
  const gatewayUrl = input.gatewayUrl.trim();

  if (!gatewayId) {
    throw new Error("gatewayId is required");
  }

  if (!gatewayUrl) {
    throw new Error("gatewayUrl is required");
  }

  return {
    async assignGatewayForTicket() {
      return {
        gatewayId,
        gatewayUrl,
      };
    },
  };
}
