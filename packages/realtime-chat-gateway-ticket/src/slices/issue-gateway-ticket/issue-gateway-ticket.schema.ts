import { z } from "zod";

export type IssueGatewayTicketRequestBodyParseResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

const IssueGatewayTicketRequestBodySchema = z.strictObject({});

export function parseIssueGatewayTicketRequestBody(
  body: unknown,
): IssueGatewayTicketRequestBodyParseResult {
  if (body === undefined || body === null) {
    return {
      ok: true,
    };
  }

  const parsed = IssueGatewayTicketRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      message:
        "issue gateway ticket request body must not include client-owned actor or workspace fields",
    };
  }

  return {
    ok: true,
  };
}
