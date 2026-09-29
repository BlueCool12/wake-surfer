import { PublicMessageSchema } from "@wake-surfer/realtime-chat-message-contracts";
import {
  DeleteMessageRequestSchema,
  DeleteMessageResponseSchema,
  EditMessageRequestSchema,
  EditMessageResponseSchema,
  type DeleteMessageResponse,
  type EditMessageResponse,
} from "@wake-surfer/realtime-chat-message-mutation-contracts";
import {
  SendMessageRequestSchema,
  type SendMessageResponse,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import {
  BeforeSequenceSchema,
  DEFAULT_STREAM_MESSAGES_PAGE_LIMIT,
  PageLimitSchema,
  type LatestStreamMessagesResponse,
  type OlderStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { ChatConnection } from "./connection.js";
import { clientError } from "./errors.js";
import { ChatApi } from "./api.js";
import { notify } from "./notifications.js";
import { copyTarget, parse, sameTarget, targetKey, validatePage } from "./protocol.js";
import { mutationResponse, sendResponse } from "./responses.js";
import { RealtimeChatClientError } from "./realtime-chat-client-error.js";
import type {
  ChatAction,
  ChatTarget,
  MessageListener,
  RealtimeChatClientOptions,
  Result,
} from "./types.js";

/** 화면에 표시되는 하나의 채팅 대상과 HTTP·WebSocket 통신을 캡슐화한다. */
export class RealtimeChatClient {
  readonly #api: ChatApi;
  readonly #connection: ChatConnection;
  readonly #lifetime = new AbortController();
  readonly #listeners = new Set<MessageListener>();
  readonly #actorId: string;
  readonly #target: ChatTarget;
  readonly #authorize: RealtimeChatClientOptions["authorize"];
  #joined = false;

  constructor(options: RealtimeChatClientOptions) {
    if (
      typeof options.actorId !== "string" ||
      !options.actorId ||
      options.actorId.trim() !== options.actorId
    ) {
      throw new TypeError("actorId에는 앞뒤 공백 없는 사용자 ID가 필요합니다.");
    }
    if (typeof options.authorize !== "function")
      throw new TypeError("authorize 함수가 필요합니다.");
    this.#actorId = options.actorId;
    this.#target = copyTarget(options.target);
    this.#authorize = options.authorize;
    this.#api = new ChatApi(options.apiBaseUrl, options.actorId, 10_000);
    this.#connection = new ChatConnection(this.#api, this.#lifetime.signal);
    this.#connection.onState((state) => {
      if (state !== "ready") this.#joined = false;
      else if (this.#listeners.size > 0) this.#join();
    });
    this.#connection.onEvent((event, payload) => {
      if (event !== "chat.message.created") return;
      const parsed = PublicMessageSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.target.type === "dm" ||
        !sameTarget(this.#target, parsed.data.target) ||
        parsed.data.streamId !== targetKey(this.#target)
      )
        return;
      for (const listener of [...this.#listeners]) notify(() => listener(parsed.data));
    });
  }

  close(): void {
    if (this.#lifetime.signal.aborted) return;
    this.#lifetime.abort(new RealtimeChatClientError("client_closed"));
    this.#listeners.clear();
    this.#connection.close();
  }

  onMessage(listener: MessageListener): () => void {
    if (typeof listener !== "function") throw new TypeError("메시지 수신 함수가 필요합니다.");
    if (!this.#allowed({ operation: "subscribe" })) return () => undefined;
    this.#listeners.add(listener);
    void this.#connection.ensureReady(this.#lifetime.signal).then(() => this.#join()).catch(() => undefined);
    return () => this.#listeners.delete(listener);
  }

  latest(): Promise<Result<LatestStreamMessagesResponse>> {
    return this.#result({ operation: "read" }, (signal) =>
      this.#api.latest(this.#target, signal).then((page) => validatePage(this.#target, page)),
    );
  }

  older(beforeSequence: number): Promise<Result<OlderStreamMessagesResponse>> {
    return this.#result({ operation: "read" }, async (signal) => {
      const request = {
        beforeSequence: parse(BeforeSequenceSchema, beforeSequence, "bad_request"),
        limit: parse(PageLimitSchema, DEFAULT_STREAM_MESSAGES_PAGE_LIMIT, "bad_request"),
      };
      const response = validatePage(this.#target, await this.#api.older(this.#target, request, signal));
      if (response.beforeSequence !== request.beforeSequence)
        throw new RealtimeChatClientError("protocol_failure");
      return response;
    });
  }

  send(text: string): Promise<Result<SendMessageResponse>> {
    return this.#result({ operation: "send" }, async (signal) => {
      const request = parse(
        SendMessageRequestSchema,
        { idempotencyKey: crypto.randomUUID(), target: this.#target, text },
        "bad_request",
      );
      await this.#connection.ensureReady(signal);
      this.#join();
      return this.#connection.request("chat.message.send", request,
        sendResponse(this.#target, this.#actorId, request.idempotencyKey), signal);
    });
  }

  edit(messageId: string, text: string): Promise<Result<EditMessageResponse>> {
    return this.#result({ operation: "edit", messageId }, async (signal) => {
      const request = parse(EditMessageRequestSchema, { messageId, text }, "bad_request");
      await this.#connection.ensureReady(signal);
      this.#join();
      return this.#connection.request("chat.message.edit", request,
        mutationResponse(this.#target, "edit", messageId, EditMessageResponseSchema), signal);
    });
  }

  delete(messageId: string): Promise<Result<DeleteMessageResponse>> {
    return this.#result({ operation: "delete", messageId }, async (signal) => {
      const request = parse(DeleteMessageRequestSchema, { messageId }, "bad_request");
      await this.#connection.ensureReady(signal);
      this.#join();
      return this.#connection.request("chat.message.delete", request,
        mutationResponse(this.#target, "delete", messageId, DeleteMessageResponseSchema), signal);
    });
  }
  async #result<T>(action: ChatAction, run: (signal: AbortSignal) => Promise<T>): Promise<Result<T>> {
    if (!this.#allowed(action)) return { ok: false, message: "채팅 권한이 없습니다." };
    try {
      return { ok: true, value: await run(this.#lifetime.signal) };
    } catch (error) {
      return { ok: false, message: clientError(error).message };
    }
  }
  #allowed(action: ChatAction): boolean {
    if (this.#lifetime.signal.aborted) return false;
    let allowed: boolean;
    try {
      allowed = this.#authorize(Object.freeze({ actorId: this.#actorId, target: this.#target, ...action }));
    } catch {
      return false;
    }
    return allowed === true;
  }
  #join(): void {
    if (this.#target.type !== "channel" || this.#joined) return;
    try {
      this.#connection.send("chat.channel.join", { channelId: this.#target.channelId });
      this.#joined = true;
    } catch {
      // 연결 객체가 새 연결을 예약한다. 다음 ready 상태에서 다시 가입한다.
    }
  }
}
