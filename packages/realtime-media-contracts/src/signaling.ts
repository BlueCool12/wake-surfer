import { z } from "zod";

import { RequestFrameSchema, type MediaErrorCode, type RequestFrame } from "./envelope.js";

/**
 * mediasoup이 소유하고 검증하는 구조 (RTP·DTLS·ICE 파라미터).
 *
 * 이 계약은 형태를 규정하지 않는다. 게이트웨이는 해석하지 않고 mediasoup에 그대로 넘기며,
 * 잘못된 값은 mediasoup이 거절한다. 여기서 스키마를 복제하면 유지 비용만 늘고 mediasoup 버전과
 * 어긋날 뿐이다. **우리 것만 검증하고 남의 것은 통과시킨다**가 이 계약의 원칙이다.
 */
export const MediasoupPayloadSchema = z.unknown();

/** @see MediasoupPayloadSchema */
export type MediasoupPayload = unknown;

export const MediaKindSchema = z.enum(["audio", "video"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** 게이트웨이가 발급한 연결 식별자. 사용자가 아니라 **연결** 단위다 — 탭 두 개는 peer 두 개다. */
export const PeerIdSchema = z.string().min(1);
export type PeerId = z.infer<typeof PeerIdSchema>;

const IdSchema = z.string().min(1);
const EmptyPayloadSchema = z.object({}).strict();

/** 방 식별자. 지금은 클라이언트가 정하는 임의 문자열이며, 인증이 붙으면 권한 검사 대상이 된다. */
export const RoomIdSchema = z.string().min(1).max(64);
export type RoomId = z.infer<typeof RoomIdSchema>;

const JoinPayloadSchema = z.object({ roomId: RoomIdSchema }).strict();

const ConnectTransportPayloadSchema = z
  .object({ transportId: IdSchema, dtlsParameters: MediasoupPayloadSchema })
  .strict();

const SetRtpCapabilitiesPayloadSchema = z
  .object({ rtpCapabilities: MediasoupPayloadSchema })
  .strict();

const ProducePayloadSchema = z
  .object({ transportId: IdSchema, kind: MediaKindSchema, rtpParameters: MediasoupPayloadSchema })
  .strict();

const ConsumePayloadSchema = z.object({ transportId: IdSchema, producerId: IdSchema }).strict();

const ResumeConsumerPayloadSchema = z.object({ consumerId: IdSchema }).strict();

const REQUEST_PAYLOAD_SCHEMAS = {
  join: JoinPayloadSchema,
  createWebRtcTransport: EmptyPayloadSchema,
  connectTransport: ConnectTransportPayloadSchema,
  setRtpCapabilities: SetRtpCapabilitiesPayloadSchema,
  produce: ProducePayloadSchema,
  listProducers: EmptyPayloadSchema,
  consume: ConsumePayloadSchema,
  resumeConsumer: ResumeConsumerPayloadSchema,
} as const;

export const MEDIA_METHODS = Object.keys(REQUEST_PAYLOAD_SCHEMAS) as readonly MediaMethod[];

export type MediaMethod = keyof typeof REQUEST_PAYLOAD_SCHEMAS;

export function isMediaMethod(value: string): value is MediaMethod {
  return Object.prototype.hasOwnProperty.call(REQUEST_PAYLOAD_SCHEMAS, value);
}

/** 검증을 통과한 요청. method로 좁히면 `data`의 타입이 따라 좁혀진다. */
export type MediaRequest = {
  [M in MediaMethod]: {
    id: number;
    method: M;
    data: z.infer<(typeof REQUEST_PAYLOAD_SCHEMAS)[M]>;
  };
}[MediaMethod];

export type MediaRequestParseResult =
  { ok: true; value: MediaRequest } | { ok: false; code: MediaErrorCode; message: string };

/**
 * 프레임 봉투와 method별 payload를 함께 검증한다.
 *
 * 게이트웨이는 클라이언트가 보낸 어떤 값도 신뢰하지 않으므로, 이 함수를 통과하지 못한 프레임은
 * 처리하지 않는다.
 */
export function parseMediaRequest(raw: unknown): MediaRequestParseResult {
  const frame = RequestFrameSchema.safeParse(raw);

  if (!frame.success) {
    return { ok: false, code: "invalid_payload", message: "요청 봉투 형식이 올바르지 않습니다." };
  }

  return parseMediaRequestFrame(frame.data);
}

export function parseMediaRequestFrame(frame: RequestFrame): MediaRequestParseResult {
  if (!isMediaMethod(frame.method)) {
    return { ok: false, code: "unknown_method", message: `알 수 없는 method: ${frame.method}` };
  }

  const payload = REQUEST_PAYLOAD_SCHEMAS[frame.method].safeParse(frame.data ?? {});

  if (!payload.success) {
    return {
      ok: false,
      code: "invalid_payload",
      message: `${frame.method} payload가 올바르지 않습니다.`,
    };
  }

  return {
    ok: true,
    value: { id: frame.id, method: frame.method, data: payload.data } as MediaRequest,
  };
}

// ── 게이트웨이가 돌려주는 응답 ──────────────────────────────────────────────

/**
 * `join` 응답.
 *
 * 방마다 Router가 다르므로 코덱 능력도 방에 따라 달라진다. 참가와 능력 조회를 한 번에 묶어
 * 왕복을 줄이고, "참가하지 않고 능력만 묻는" 상태를 아예 만들지 않는다.
 */
export type JoinResult = {
  roomId: RoomId;
  routerRtpCapabilities: MediasoupPayload;
  peerCount: number;
};

/** `createWebRtcTransport` 응답. 그대로 mediasoup-client의 `createSendTransport`에 넘긴다. */
export type WebRtcTransportDescriptor = {
  id: string;
  iceParameters: MediasoupPayload;
  iceCandidates: MediasoupPayload;
  dtlsParameters: MediasoupPayload;
};

export type ProduceResult = { id: string };

/** 내가 들어오기 전부터 송출 중이던 참가자 목록. */
export type ProducerDescriptor = { producerId: string; peerId: PeerId };

/** `consume` 응답. 그대로 mediasoup-client의 `transport.consume`에 넘긴다. */
export type ConsumerDescriptor = {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: MediasoupPayload;
};

// ── 게이트웨이가 밀어 보내는 알림 ───────────────────────────────────────────

export const WelcomeNotificationSchema = z.object({ peerId: PeerIdSchema }).strict();

export const NewProducerNotificationSchema = z
  .object({ producerId: IdSchema, peerId: PeerIdSchema })
  .strict();

export const PeerClosedNotificationSchema = z.object({ peerId: PeerIdSchema }).strict();

const NOTIFICATION_SCHEMAS = {
  welcome: WelcomeNotificationSchema,
  newProducer: NewProducerNotificationSchema,
  peerClosed: PeerClosedNotificationSchema,
} as const;

export type MediaNotificationMethod = keyof typeof NOTIFICATION_SCHEMAS;

export type MediaNotification = {
  [M in MediaNotificationMethod]: {
    method: M;
    data: z.infer<(typeof NOTIFICATION_SCHEMAS)[M]>;
  };
}[MediaNotificationMethod];

export function isMediaNotificationMethod(value: string): value is MediaNotificationMethod {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_SCHEMAS, value);
}

/** 클라이언트가 서버 알림을 좁힐 때 쓴다. 모르는 method는 조용히 무시하도록 `undefined`를 준다. */
export function parseMediaNotification(
  method: string,
  data: unknown,
): MediaNotification | undefined {
  if (!isMediaNotificationMethod(method)) {
    return undefined;
  }

  const parsed = NOTIFICATION_SCHEMAS[method].safeParse(data);

  return parsed.success ? ({ method, data: parsed.data } as MediaNotification) : undefined;
}
