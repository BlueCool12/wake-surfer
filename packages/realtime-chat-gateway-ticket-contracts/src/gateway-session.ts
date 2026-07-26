import { z } from "zod";

export const REALTIME_CHAT_PROTOCOL_VERSION = 1;

const OpaqueConnectionIdentifierSchema = z.string().trim().min(1).max(128);
const ConnectedAtSchema = z
  .string()
  .trim()
  .pipe(z.iso.datetime({ offset: true }));

export const GatewayConnectedEventSchema = z.strictObject({
  protocolVersion: z.literal(REALTIME_CHAT_PROTOCOL_VERSION),
  connectionGeneration: OpaqueConnectionIdentifierSchema,
  gatewayId: OpaqueConnectionIdentifierSchema,
  sessionId: OpaqueConnectionIdentifierSchema,
  connectedAt: ConnectedAtSchema,
});

export type GatewayConnectedEvent = z.infer<typeof GatewayConnectedEventSchema>;

export const GatewayNotReadyEventSchema = z.strictObject({
  code: z.literal("gateway.not_ready"),
});

export type GatewayNotReadyEvent = z.infer<typeof GatewayNotReadyEventSchema>;
