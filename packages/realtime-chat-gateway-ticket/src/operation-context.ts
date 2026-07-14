export type GatewayTicketOperationContext = {
  signal?: AbortSignal;
};

export function throwIfGatewayTicketOperationAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
