import {
  StreamMessagesSessionModel,
  type StreamMessagesSessionModelOptions,
} from "./session-model.js";

const sessions = new Map<string, StreamMessagesSessionModel>();

export function getStreamMessagesSession(
  options: StreamMessagesSessionModelOptions,
): StreamMessagesSessionModel {
  const key = createSessionKey(options.actorId, options.channelId);
  let session = sessions.get(key);

  if (session === undefined) {
    session = new StreamMessagesSessionModel(options);
    sessions.set(key, session);
  }

  return session;
}

export function disposeStreamMessagesSession(input: {
  actorId: string;
  channelId: string;
  clearCursor: boolean;
}): void {
  const key = createSessionKey(input.actorId, input.channelId);
  const session = sessions.get(key);
  session?.dispose({ clearCursor: input.clearCursor });
  sessions.delete(key);
}

export function disposeActorStreamMessagesSessions(actorId: string): void {
  const prefix = `${encodeURIComponent(actorId)}:`;

  for (const [key, session] of sessions) {
    if (key.startsWith(prefix)) {
      session.dispose({ clearCursor: true });
      sessions.delete(key);
    }
  }
}

function createSessionKey(actorId: string, channelId: string): string {
  return `${encodeURIComponent(actorId)}:${encodeURIComponent(channelId)}`;
}
