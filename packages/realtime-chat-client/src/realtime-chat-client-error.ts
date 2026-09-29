export class RealtimeChatClientError extends Error {
  readonly retryAfterMs: number | undefined;
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    options: ErrorOptions & { retryAfterMs?: number; retryable?: boolean } = {},
  ) {
    super("채팅 클라이언트 작업에 실패했습니다: " + code, options);
    this.name = "RealtimeChatClientError";
    this.retryAfterMs = options.retryAfterMs;
    this.retryable =
      options.retryable ??
      ["stream_messages_unavailable", "socket_closed", "timeout"].includes(code);
  }
}
