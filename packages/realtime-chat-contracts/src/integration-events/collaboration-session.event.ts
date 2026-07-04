import type {
  ChannelId,
  EventId,
  ISODateTime,
  UserId,
  WorkspaceId
} from '../primitives';

export type CollaborationSessionStarted = {
  eventId: EventId;
  eventType: 'CollaborationSessionStarted';
  occurredAt: ISODateTime;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  sessionId: string;
  startedBy?: UserId;
  title?: string;
};
