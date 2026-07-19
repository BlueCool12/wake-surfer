export type StreamMessagesDomainErrorCode = "stream_unavailable" | "invalid_cursor";

export class StreamMessagesDomainError extends Error {
  readonly code: StreamMessagesDomainErrorCode;

  constructor(code: StreamMessagesDomainErrorCode) {
    super(
      code === "stream_unavailable"
        ? "메시지 stream을 조회할 수 없습니다."
        : "cursor가 유효하지 않습니다.",
    );
    this.name = "StreamMessagesDomainError";
    this.code = code;
  }
}

export type StreamMessagesDataIntegrityReason =
  "stream_target_mismatch" | "sequence_gap" | "invalid_storage_row";

export class StreamMessagesDataIntegrityError extends Error {
  readonly reason: StreamMessagesDataIntegrityReason;
  readonly metadata: Readonly<Record<string, number | string>>;

  constructor(
    reason: StreamMessagesDataIntegrityReason,
    metadata: Readonly<Record<string, number | string>>,
  ) {
    super(`Stream Messages 데이터 무결성 검증에 실패했습니다: ${reason}`);
    this.name = "StreamMessagesDataIntegrityError";
    this.reason = reason;
    this.metadata = metadata;
  }
}
