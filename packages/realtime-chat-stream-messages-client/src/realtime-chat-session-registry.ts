import type { KeyValueStorage } from "./cursor-storage.js";
import {
  RealtimeChatTargetSession,
  type RealtimeChatTargetSessionOptions,
} from "./realtime-chat-session.js";
import type { RealtimeChatTargetRuntimeFactory } from "./runtime.js";
import { getStreamMessagesClientTargetKey, type StreamMessagesClientTarget } from "./target.js";

export type RealtimeChatTargetSessionRegistryOptions = {
  runtimeFactory: RealtimeChatTargetRuntimeFactory;
};

export class RealtimeChatTargetSessionRegistry {
  readonly #runtimeFactory: RealtimeChatTargetRuntimeFactory;
  readonly #sessions = new Map<string, RealtimeChatTargetSession>();

  constructor(options: RealtimeChatTargetSessionRegistryOptions) {
    this.#runtimeFactory = options.runtimeFactory;
  }

  getSession(input: {
    actorId: string;
    target: StreamMessagesClientTarget;
    storage: KeyValueStorage;
  }): RealtimeChatTargetSession {
    const key = createSessionKey(input.actorId, input.target);
    let session = this.#sessions.get(key);

    if (session === undefined) {
      const options: RealtimeChatTargetSessionOptions = {
        ...input,
        runtime: this.#runtimeFactory({ actorId: input.actorId, target: input.target }),
      };
      session = new RealtimeChatTargetSession(options);
      this.#sessions.set(key, session);
    }

    return session;
  }

  disposeActor(actorId: string): void {
    for (const [key, session] of this.#sessions) {
      if (session.options.actorId === actorId) {
        session.dispose({ clearCursor: true });
        this.#sessions.delete(key);
      }
    }
  }

  dispose(): void {
    for (const session of this.#sessions.values()) {
      session.dispose({ clearCursor: false });
    }

    this.#sessions.clear();
  }
}

function createSessionKey(actorId: string, target: StreamMessagesClientTarget): string {
  return JSON.stringify([actorId, getStreamMessagesClientTargetKey(target)]);
}
