import type { RealtimeChatClientEvent } from './client-events';
import type { RealtimeChatServerEvent } from './server-events';

export type RealtimeChatSocketEvent =
  | RealtimeChatClientEvent
  | RealtimeChatServerEvent;

export type RealtimeChatClientEventType = RealtimeChatClientEvent['type'];
export type RealtimeChatServerEventType = RealtimeChatServerEvent['type'];
