import type { EventId, ISODateTime, UserId, WorkspaceId } from "../primitives";

export type PresenceChanged = {
  eventId: EventId;
  eventType: "PresenceChanged";
  occurredAt: ISODateTime;
  workspaceId: WorkspaceId;
  userId: UserId;
  status: "online" | "away" | "offline";
};
