import type {
  ConsumeGatewayTicketResponse,
  GatewayId,
  GatewayTicket,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatApiRuntimeDeps } from "../runtime-deps";
import { defaultTicketHasher } from "../domain/gateway-ticket";

export type ConsumeGatewayTicketCommand = {
  ticket: GatewayTicket;
  gatewayId: GatewayId;
};

type ConsumeGatewayTicketUsecaseDeps = {
  now: () => Date;
  hashTicket: (ticketValue: GatewayTicket) => string | Promise<string>;
  consumeStoredGatewayTicket: (input: {
    ticketValueHash: string;
    gatewayId: GatewayId;
    consumedAt: string;
  }) => Promise<ConsumeGatewayTicketResponse>;
};

export type ConsumeGatewayTicketUsecase = (
  command: ConsumeGatewayTicketCommand,
) => Promise<ConsumeGatewayTicketResponse>;

export function createConsumeGatewayTicketUsecase(
  runtimeDeps: RealtimeChatApiRuntimeDeps,
): ConsumeGatewayTicketUsecase {
  const hasher = runtimeDeps.ticketHasher ?? defaultTicketHasher;

  return (command) =>
    consumeGatewayTicket(command, {
      now: () => runtimeDeps.clock.now(),
      hashTicket: (ticketValue) => hasher.hash(ticketValue),
      consumeStoredGatewayTicket: (input) => runtimeDeps.db.consumeGatewayTicket(input),
    });
}

export async function consumeGatewayTicket(
  command: ConsumeGatewayTicketCommand,
  deps: ConsumeGatewayTicketUsecaseDeps,
): Promise<ConsumeGatewayTicketResponse> {
  const ticketValueHash = await deps.hashTicket(command.ticket);

  return deps.consumeStoredGatewayTicket({
    ticketValueHash,
    gatewayId: command.gatewayId,
    consumedAt: deps.now().toISOString(),
  });
}
