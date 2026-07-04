import type { CommandId, ISODateTime, StreamId, UserId } from '../primitives';

export type MarkReadCursorRequest = {
  requestId: string;
  actorId: UserId;
  streamId: StreamId;
  lastReadSequence: number;
};

export type MarkReadCursorResponse = {
  status: 'advanced' | 'unchanged';
  commandId: CommandId;
  streamId: StreamId;
  lastReadSequence: number;
  updatedAt: ISODateTime;
};
