import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";

export type ChatTarget =
  | { readonly type: "channel"; readonly channelId: string }
  | { readonly type: "thread"; readonly threadId: string };
export type ChatAction =
  | { operation: "read" | "subscribe" | "send" }
  | { operation: "edit" | "delete"; messageId: string };

/** 인증 계층이 가진 최신 권한 데이터로 판정한다. 서버의 권한 검사를 대체하지 않는다. */
export type ChatAuthorizationRequest = Readonly<
  {
    actorId: string;
    target: ChatTarget;
  } & ChatAction
>;

export interface RealtimeChatClientOptions {
  apiBaseUrl: string | URL;
  actorId: string;
  target: ChatTarget;
  /** 이미 확보한 권한 데이터를 동기적으로 확인한다. 허용 기본값은 없다. */
  authorize: (request: ChatAuthorizationRequest) => boolean;
}

/** 통신 실패는 message로, 서버의 도메인 거절은 value의 계약 응답으로 전달한다. */
export type Result<T> = { ok: true; value: T } | { ok: false; message: string };
export type MessageListener = (message: PublicMessage) => void;

export type ConnectionState = "closed" | "connecting" | "ready";
