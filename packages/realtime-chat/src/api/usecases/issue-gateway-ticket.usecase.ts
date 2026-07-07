import type {
  IssueGatewayTicketResponse,
  RealtimeChatErrorCode,
  UserId,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatApiMountOptions } from "../http/mount";
import type { RealtimeChatApiRuntimeDeps, StoredGatewayTicket } from "../runtime-deps";
import {
  defaultTicketHasher,
  type IssuedGatewayTicket,
  issueGatewayTicketDomain,
  toIssueGatewayTicketResponse,
  toStoredGatewayTicket,
} from "../domain/gateway-ticket";

export type IssueGatewayTicketCommand = {
  actorId: UserId;
};

declare const authorizedGatewayTicketIssueBrand: unique symbol;

type AuthorizedGatewayTicketIssue = IssueGatewayTicketCommand & {
  readonly [authorizedGatewayTicketIssueBrand]: true;
};

export type IssueGatewayTicketResult =
  | {
      status: "issued";
      response: IssueGatewayTicketResponse;
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };

type GatewayTicketIssue = {
  commit: (deps: {
    saveGatewayTicket: (ticket: StoredGatewayTicket) => Promise<void>;
  }) => Promise<void>;
  toResult: () => IssueGatewayTicketResult;
};

type IssueAuthorizedGatewayTicket = (
  issue: AuthorizedGatewayTicketIssue,
) => Promise<GatewayTicketIssue>;

type IssueGatewayTicketUsecaseDeps = {
  authorizeGatewayTicketIssue: (
    command: IssueGatewayTicketCommand,
    next: IssueAuthorizedGatewayTicket,
  ) => Promise<GatewayTicketIssue>;
  issueAuthorizedGatewayTicket: IssueAuthorizedGatewayTicket;
  saveGatewayTicket: (ticket: StoredGatewayTicket) => Promise<void>;
};

export type IssueGatewayTicketUsecase = (
  command: IssueGatewayTicketCommand,
) => Promise<IssueGatewayTicketResult>;

export function createIssueGatewayTicketUsecase(
  runtimeDeps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions,
): IssueGatewayTicketUsecase {
  const ticketTtlSeconds = normalizeGatewayTicketTtlSeconds(options.gatewayTicketTtlSeconds);

  return (command) =>
    issueGatewayTicket(command, {
      authorizeGatewayTicketIssue: async (ticketCommand, next) => {
        const permission = await runtimeDeps.permissionPort.canIssueGatewayTicket({
          actorId: ticketCommand.actorId,
        });

        if (!permission.allowed) {
          return rejectedGatewayTicketIssue({
            reason: permission.reason,
            ...(permission.message ? { message: permission.message } : {}),
          });
        }

        return next(toAuthorizedGatewayTicketIssue(ticketCommand));
      },
      issueAuthorizedGatewayTicket: async (issue) => {
        const hasher = runtimeDeps.ticketHasher ?? defaultTicketHasher;
        const assignedGateway = await runtimeDeps.gatewayAssignmentPort.assignGatewayForTicket({
          actorId: issue.actorId,
        });
        const issuedTicket = await issueGatewayTicketDomain({
          actorId: issue.actorId,
          assignedGateway,
          issuedAt: runtimeDeps.clock.now(),
          ticketTtlSeconds,
          generateId: (scope) => runtimeDeps.idGenerator.generateId(scope),
          hashTicket: (ticketValue) => hasher.hash(ticketValue),
        });

        return issuedGatewayTicketIssue(issuedTicket);
      },
      saveGatewayTicket: (ticket) => runtimeDeps.db.issueGatewayTicket(ticket),
    });
}

export async function issueGatewayTicket(
  command: IssueGatewayTicketCommand,
  deps: IssueGatewayTicketUsecaseDeps,
): Promise<IssueGatewayTicketResult> {
  const ticketIssue = await deps.authorizeGatewayTicketIssue(
    command,
    deps.issueAuthorizedGatewayTicket,
  );

  await ticketIssue.commit({
    saveGatewayTicket: deps.saveGatewayTicket,
  });

  return ticketIssue.toResult();
}

function issuedGatewayTicketIssue(ticket: IssuedGatewayTicket): GatewayTicketIssue {
  return {
    commit: async ({ saveGatewayTicket }) => {
      await saveGatewayTicket(toStoredGatewayTicket(ticket));
    },
    toResult: () => ({
      status: "issued",
      response: toIssueGatewayTicketResponse(ticket),
    }),
  };
}

function rejectedGatewayTicketIssue(rejection: {
  reason: RealtimeChatErrorCode;
  message?: string;
}): GatewayTicketIssue {
  return {
    commit: async () => undefined,
    toResult: () => ({
      status: "rejected",
      reason: rejection.reason,
      ...(rejection.message ? { message: rejection.message } : {}),
    }),
  };
}

function toAuthorizedGatewayTicketIssue(
  command: IssueGatewayTicketCommand,
): AuthorizedGatewayTicketIssue {
  return command as AuthorizedGatewayTicketIssue;
}

function normalizeGatewayTicketTtlSeconds(value: number | undefined): number {
  const ttlSeconds = value ?? 60;

  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("gatewayTicketTtlSeconds must be a positive number");
  }

  return ttlSeconds;
}
