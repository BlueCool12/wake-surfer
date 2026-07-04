import type { PublicMessageDto } from './message.dto';
import type { RequestId, StreamId, UserId } from '../primitives';

export type SyncStreamMessagesRequest = {
  requestId: RequestId;
  actorId: UserId;
  streamId: StreamId;
  afterSequence?: number;
  beforeSequence?: number;
  limit?: number;
};

export type SyncStreamMessagesResponse = {
  streamId: StreamId;
  messages: PublicMessageDto[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};
