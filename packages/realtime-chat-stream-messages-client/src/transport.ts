import type {
  LatestStreamMessagesHttpRequest,
  LatestThreadStreamMessagesHttpRequest,
  LatestStreamMessagesResponse,
  OlderStreamMessagesHttpRequest,
  OlderThreadStreamMessagesHttpRequest,
  OlderStreamMessagesResponse,
  SyncAfterStreamMessagesRequest,
  SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

export type MeasuredTransportResponse<Response> = {
  response: Response;
  rawUtf8ByteLength: number;
};

export type LatestStreamMessagesRequest =
  LatestStreamMessagesHttpRequest | LatestThreadStreamMessagesHttpRequest;

export type OlderStreamMessagesRequest =
  OlderStreamMessagesHttpRequest | OlderThreadStreamMessagesHttpRequest;

export type StreamMessagesTransport = {
  loadLatest: (
    request: LatestStreamMessagesRequest,
    context: { signal: AbortSignal },
  ) => Promise<MeasuredTransportResponse<LatestStreamMessagesResponse>>;
  loadOlder: (
    request: OlderStreamMessagesRequest,
    context: { signal: AbortSignal },
  ) => Promise<MeasuredTransportResponse<OlderStreamMessagesResponse>>;
  syncAfter: (
    request: SyncAfterStreamMessagesRequest,
    context: { signal: AbortSignal },
  ) => Promise<MeasuredTransportResponse<SyncAfterStreamMessagesResponse>>;
};
