import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatApiRuntimeDeps } from "../runtime-deps";
import { defaultTicketHasher } from "../domain/gateway-ticket";

export async function consumeGatewayTicket(
  request: ConsumeGatewayTicketRequest,
  deps: RealtimeChatApiRuntimeDeps,
): Promise<ConsumeGatewayTicketResponse> {
  const hasher = deps.ticketHasher ?? defaultTicketHasher;
  const ticketValueHash = await hasher.hash(request.ticket);

  return deps.db.consumeGatewayTicket({
    ticketValueHash,
    consumedAt: deps.clock.now().toISOString(),
  });
}
