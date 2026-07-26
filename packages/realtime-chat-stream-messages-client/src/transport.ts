import type {
  LatestStreamMessagesHttpRequest,
  LatestStreamMessagesResponse,
  OlderStreamMessagesHttpRequest,
  OlderStreamMessagesResponse,
  SyncAfterStreamMessagesRequest,
  SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

export type MeasuredTransportResponse<Response> = {
  response: Response;
  rawUtf8ByteLength: number;
};

export type StreamMessagesTransport = {
  loadLatest: (
    request: LatestStreamMessagesHttpRequest,
    context: { signal: AbortSignal },
  ) => Promise<MeasuredTransportResponse<LatestStreamMessagesResponse>>;
  loadOlder: (
    request: OlderStreamMessagesHttpRequest,
    context: { signal: AbortSignal },
  ) => Promise<MeasuredTransportResponse<OlderStreamMessagesResponse>>;
  syncAfter: (
    request: SyncAfterStreamMessagesRequest,
    context: { signal: AbortSignal },
  ) => Promise<MeasuredTransportResponse<SyncAfterStreamMessagesResponse>>;
};
