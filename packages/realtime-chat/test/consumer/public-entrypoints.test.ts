import { describe, expect, it } from "vitest";

import * as realtimeChat from "@wake-surfer/realtime-chat";
import * as realtimeChatApi from "@wake-surfer/realtime-chat/api";
import * as realtimeChatGateway from "@wake-surfer/realtime-chat/gateway";
import * as realtimeChatContracts from "@wake-surfer/realtime-chat-contracts";

describe("consumer 공개 entrypoint", () => {
  it("root package에서 문서화된 mount 함수를 노출한다", () => {
    expect(typeof realtimeChat.mountRealtimeChatApi).toBe("function");
    expect(typeof realtimeChat.mountRealtimeChatGateway).toBe("function");
  });

  it("public subpath에서 adapter별 mount 함수를 노출한다", () => {
    expect(typeof realtimeChatApi.mountRealtimeChatApi).toBe("function");
    expect(typeof realtimeChatGateway.mountRealtimeChatGateway).toBe("function");
  });

  it("contract package root에서 public runtime 값을 노출한다", () => {
    expect(Array.isArray(realtimeChatContracts.REALTIME_CHAT_ERROR_CODES)).toBe(true);
  });
});
