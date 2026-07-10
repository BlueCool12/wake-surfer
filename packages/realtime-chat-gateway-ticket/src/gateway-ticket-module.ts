import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
  IssueGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type { Kysely } from "kysely";
import { createGatewayTicketPolicy } from "./gateway-ticket";
import type { GatewayTicketDatabase } from "./gateway-ticket-table";
import { consumeGatewayTicket } from "./usecases/consume-gateway-ticket/consume-gateway-ticket.usecase";
import type { ConsumeGatewayTicketContext } from "./usecases/consume-gateway-ticket/consume-gateway-ticket.usecase";
import type {
  GatewayAssigner,
  IssueGatewayTicketCommand,
} from "./usecases/issue-gateway-ticket/issue-gateway-ticket.usecase";
import { issueGatewayTicket } from "./usecases/issue-gateway-ticket/issue-gateway-ticket.usecase";

export type CreateGatewayTicketModuleConfig<
  DB extends GatewayTicketDatabase = GatewayTicketDatabase,
> = {
  db: Kysely<DB>;
  assignGateway: GatewayAssigner;
  ticketTtlMilliseconds: number;
  rawTicketBytes: number;
};

export type GatewayTicketModule = {
  issue: (command: IssueGatewayTicketCommand) => Promise<IssueGatewayTicketResponse>;
  consume: (
    command: ConsumeGatewayTicketRequest,
    context: ConsumeGatewayTicketContext,
  ) => Promise<ConsumeGatewayTicketResponse>;
};

export function createGatewayTicketModule<DB extends GatewayTicketDatabase = GatewayTicketDatabase>(
  config: CreateGatewayTicketModuleConfig<DB>,
): GatewayTicketModule {
  const ticketPolicy = createGatewayTicketPolicy({
    ttlMilliseconds: config.ticketTtlMilliseconds,
    rawTicketBytes: config.rawTicketBytes,
  });
  const db = config.db as Kysely<GatewayTicketDatabase>;

  return {
    issue(command) {
      return issueGatewayTicket(command, {
        db,
        now: createNow,
        assignGateway: config.assignGateway,
        ticketPolicy,
      });
    },
    consume(command, context) {
      return consumeGatewayTicket(command, context, {
        db,
        now: createNow,
      });
    },
  };
}

function createNow(): Date {
  return new Date();
}
