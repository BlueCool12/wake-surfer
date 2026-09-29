import { IssueGatewayTicketResponseSchema } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import {
  LatestStreamMessagesResponseSchema,
  OlderStreamMessagesResponseSchema,
  MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  StreamMessagesHttpErrorResponseSchema,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { assertActive, serverError } from "./errors.js";
import { RealtimeChatClientError } from "./realtime-chat-client-error.js";
import { withTimeout } from "./operations.js";
import { parse, parseJson, targetFields } from "./protocol.js";
import type { ChatTarget } from "./types.js";

export class ChatApi {
  readonly #base: URL;
  readonly #actorId: string;
  constructor(apiBaseUrl: string | URL, actorId: string, readonly timeout: number) {
    this.#base = new URL(apiBaseUrl);
    if (!["http:", "https:"].includes(this.#base.protocol))
      throw new TypeError("apiBaseUrl은 HTTP(S)여야 합니다.");
    if (!this.#base.pathname.endsWith("/")) this.#base.pathname += "/";
    this.#actorId = actorId;
  }

  async issueTicket(signal: AbortSignal) {
    return parse(IssueGatewayTicketResponseSchema,
      await this.#json(new URL("realtime-chat/gateway-tickets", this.#base), signal, true));
  }
  async latest(target: ChatTarget, signal: AbortSignal) {
    return parse(LatestStreamMessagesResponseSchema, await this.#json(this.#url(target, "latest"), signal));
  }
  async older(target: ChatTarget, input: { beforeSequence: number; limit: number }, signal: AbortSignal) {
    const url = this.#url(target, "older");
    url.searchParams.set("beforeSequence", String(input.beforeSequence));
    url.searchParams.set("limit", String(input.limit));
    return parse(OlderStreamMessagesResponseSchema, await this.#json(url, signal));
  }
  #url(target: ChatTarget, page: string): URL {
    const fields = targetFields(target);
    const id = "channelId" in fields ? fields.channelId : fields.threadId;
    return new URL(`realtime-chat/${target.type === "channel" ? "channels" : "threads"}/${encodeURIComponent(id)}/messages/${page}`, this.#base);
  }
  #json(url: URL, parent: AbortSignal, ticket = false): Promise<unknown> {
    return withTimeout(parent, this.timeout, async (signal) => {
      const requestId = crypto.randomUUID();
      let response: Response;
      let raw: string;
      try {
        response = await globalThis.fetch(url, {
          method: ticket ? "POST" : "GET", credentials: "include", signal,
          headers: { accept: "application/json", "x-actor-id": this.#actorId, "x-request-id": requestId },
        });
        if (response.status === 401 || response.status === 403)
          throw new RealtimeChatClientError(ticket ? "ticket_rejected" : "access_denied");
        raw = await response.text();
      } catch (cause) {
        assertActive(signal);
        if (cause instanceof RealtimeChatClientError) throw cause;
        throw new RealtimeChatClientError("stream_messages_unavailable", { cause });
      }
      assertActive(signal);
      if ([500, 502, 503, 504].includes(response.status)) {
        try {
          const result = StreamMessagesHttpErrorResponseSchema.safeParse(parseJson(raw));
          if (result.success) throw serverError(result.data);
        } catch (error) {
          if (error instanceof RealtimeChatClientError && error.code !== "protocol_failure") throw error;
        }
        throw new RealtimeChatClientError("stream_messages_unavailable");
      }
      if (ticket && !response.ok) throw new RealtimeChatClientError("ticket_rejected");
      if (new TextEncoder().encode(raw).byteLength > MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES)
        throw new RealtimeChatClientError("protocol_failure");
      if (!ticket && response.headers.get("x-request-id") !== requestId)
        throw new RealtimeChatClientError("stale_response");
      const value = parseJson(raw);
      if (!response.ok) throw serverError(parse(StreamMessagesHttpErrorResponseSchema, value));
      return value;
    });
  }
}
