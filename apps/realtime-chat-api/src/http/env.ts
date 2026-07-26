import type { GatewayTicketDeadlineVariables } from "./gateway-ticket-deadline.js";
import type { RealtimeChatApiRequestIdVariables } from "./request-id.js";

export type RealtimeChatApiEnv = {
  Variables: RealtimeChatApiRequestIdVariables & GatewayTicketDeadlineVariables;
};
