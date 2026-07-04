import type { RealtimeChatServerEvent } from '@wake-surfer/realtime-chat-contracts';
import type { WebSocketConnectionLike } from './websocket-server-like';

export async function sendSocketEvent(
  connection: WebSocketConnectionLike,
  event: RealtimeChatServerEvent
): Promise<void> {
  await connection.send(JSON.stringify(event));
}
