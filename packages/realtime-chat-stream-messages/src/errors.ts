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
