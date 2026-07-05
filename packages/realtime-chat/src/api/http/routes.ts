import type { RealtimeChatApiMountOptions } from './mount';
import type { HttpServerLike } from './http-server-like';
import type { RealtimeChatUsecases } from '../application/create-usecases';
import { createConsumeGatewayTicketHandler } from './handlers/consume-gateway-ticket.handler';
import { createIssueGatewayTicketHandler } from './handlers/issue-gateway-ticket.handler';
import { createMarkAsReadHandler } from './handlers/mark-as-read.handler';
import { createReplyThreadMessageHandler } from './handlers/reply-thread-message.handler';
import { createSendChannelMessageHandler } from './handlers/send-channel-message.handler';
import { createSendDMMessageHandler } from './handlers/send-dm-message.handler';
import { createSyncStreamHandler } from './handlers/sync-stream.handler';
import { createPostSessionStartedSystemMessageHandler } from './handlers/post-session-started-system-message.handler';

export async function registerRealtimeChatApiRoutes(
  server: HttpServerLike,
  options: RealtimeChatApiMountOptions,
  usecases: RealtimeChatUsecases
): Promise<void> {
  const basePath = normalizeBasePath(options.basePath);

  await server.route({
    method: 'POST',
    path: joinRoute(basePath, '/gateway-tickets'),
    handler: createIssueGatewayTicketHandler(usecases)
  });
  await server.route({
    method: 'POST',
    path: joinRoute(basePath, '/internal/gateway-tickets/consume'),
    handler: createConsumeGatewayTicketHandler(usecases)
  });
  await server.route({
    method: 'POST',
    path: joinRoute(basePath, '/internal/messages/channel'),
    handler: createSendChannelMessageHandler(usecases)
  });
  await server.route({
    method: 'POST',
    path: joinRoute(basePath, '/internal/messages/dm'),
    handler: createSendDMMessageHandler(usecases)
  });
  await server.route({
    method: 'POST',
    path: joinRoute(basePath, '/internal/messages/thread-replies'),
    handler: createReplyThreadMessageHandler(usecases)
  });
  await server.route({
    method: 'POST',
    path: joinRoute(basePath, '/internal/read-cursors'),
    handler: createMarkAsReadHandler(usecases)
  });
  await server.route({
    method: 'GET',
    path: joinRoute(basePath, '/streams/:streamId/messages'),
    handler: createSyncStreamHandler(usecases)
  });
  await server.route({
    method: 'POST',
    path: joinRoute(basePath, '/internal/system-messages/session-started'),
    handler: createPostSessionStartedSystemMessageHandler(usecases)
  });
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim();

  if (trimmed === '' || trimmed === '/') {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

function joinRoute(basePath: string, suffix: string): string {
  return `${basePath}${suffix}`;
}
