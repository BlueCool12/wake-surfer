export type StreamMessageProtocolErrorReason =
  | "message_identity_conflict"
  | "message_target_mismatch"
  | "sync_cursor_mismatch"
  | "sync_no_progress";

export class StreamMessageProtocolError extends Error {
  readonly reason: StreamMessageProtocolErrorReason;
  readonly metadata: Readonly<Record<string, number | string>>;

  constructor(
    reason: StreamMessageProtocolErrorReason,
    metadata: Readonly<Record<string, number | string>>,
  ) {
    super(`Stream Messages client protocol 검증에 실패했습니다: ${reason}`);
    this.name = "StreamMessageProtocolError";
    this.reason = reason;
    this.metadata = metadata;
  }
}

export type StreamMessagesTransportErrorCode =
  | "stream_unavailable"
  | "invalid_cursor"
  | "rate_limited"
  | "stream_messages_unavailable"
  | "protocol_failure"
  | "cancelled";

export class StreamMessagesTransportError extends Error {
  readonly code: StreamMessagesTransportErrorCode;
  readonly retryAfterMs: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: StreamMessagesTransportErrorCode,
    options: {
      retryAfterMs?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(`Stream Messages transport failed: ${code}`);
    this.name = "StreamMessagesTransportError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? code === "stream_messages_unavailable";
  }
}
