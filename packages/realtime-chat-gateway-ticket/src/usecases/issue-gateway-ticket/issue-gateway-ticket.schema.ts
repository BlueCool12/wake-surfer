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
        "게이트웨이 티켓 발급 요청 본문에는 클라이언트가 소유한 actor 또는 workspace 필드를 포함할 수 없습니다.",
    };
  }

  return {
    ok: true,
  };
}
