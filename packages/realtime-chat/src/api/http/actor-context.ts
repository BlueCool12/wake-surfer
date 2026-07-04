import type { HttpRequestLike } from './http-server-like';

export function extractActorId(request: HttpRequestLike): string | undefined {
  const actorId = request.headers['x-actor-id'];
  return typeof actorId === 'string' && actorId.trim() !== ''
    ? actorId.trim()
    : undefined;
}
