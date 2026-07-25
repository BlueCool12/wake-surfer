import { ChatRoomModel } from "./chatRoomModel";

import type { KeyValueStorage } from "@wake-surfer/realtime-chat-stream-messages-client";
import type { ChatRoomRuntimeFactory } from "./transport/chatTransport";

const models = new Map<string, ChatRoomModel>();
let configuredRuntimeFactory: ChatRoomRuntimeFactory | undefined;

export function configureChatRoomRuntimeFactory(factory: ChatRoomRuntimeFactory): void {
  configuredRuntimeFactory = factory;
}

export function getChatRoomModel(input: {
  actorId: string;
  channelId: string;
  storage: KeyValueStorage;
}): ChatRoomModel {
  const key = JSON.stringify([input.actorId, input.channelId]);
  let model = models.get(key);

  if (model === undefined) {
    const runtimeFactory = getRuntimeFactory(input.actorId);
    model = new ChatRoomModel({
      ...input,
      runtime: runtimeFactory({ actorId: input.actorId, channelId: input.channelId }),
    });
    models.set(key, model);
  }

  return model;
}

export function disposeActorChatRoomModels(actorId: string): void {
  for (const [key, model] of models) {
    if (model.options.actorId === actorId) {
      model.dispose({ clearCursor: true });
      models.delete(key);
    }
  }
}

function getRuntimeFactory(actorId: string): ChatRoomRuntimeFactory {
  if (configuredRuntimeFactory !== undefined) {
    return configuredRuntimeFactory;
  }

  throw new Error(`${actorId} actor의 인증된 Realtime Chat runtime이 설정되지 않았습니다.`);
}
