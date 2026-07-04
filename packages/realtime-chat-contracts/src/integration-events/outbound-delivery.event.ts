import type {
  EventId,
  ISODateTime,
  MessageId,
  StreamId,
  StreamType,
  UserId
} from '../primitives';
import type { ChatMessageCreatedEvent } from '../socket/server-events';

export type OutboundMessageDeliveryRequested = {
  eventId: EventId;
  eventType: 'OutboundMessageDeliveryRequested';
  occurredAt: ISODateTime;
  streamId: StreamId;
  streamType: StreamType;
  messageId: MessageId;
  sequence: number;
  recipientUserIds: UserId[];
  payload: ChatMessageCreatedEvent;
};
