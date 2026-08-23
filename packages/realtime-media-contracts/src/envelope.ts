import { z } from "zod";

/**
 * 한 프레임의 최대 크기.
 *
 * mediasoup의 RTP capabilities는 코덱·헤더 확장 목록을 통째로 실어 채팅 메시지보다 훨씬 크다.
 * 게이트웨이 WebSocket 상한을 이 값에 맞춘다.
 */
export const MAX_FRAME_UTF8_BYTES = 262_144;

export const RequestIdSchema = z.number().int().positive();

export const MAX_METHOD_LENGTH = 64;

// 클라이언트 → 게이트웨이 요청
export const RequestFrameSchema = z
  .object({
    id: RequestIdSchema,
    method: z.string().min(1).max(MAX_METHOD_LENGTH),
    data: z.unknown().optional(),
  })
  .strict();

export type RequestFrame = z.infer<typeof RequestFrameSchema>;

// 게이트웨이 → 클라이언트 응답
/**
 * 실패 사유 코드.
 *
 * `error`는 사람이 읽는 문구라 바뀔 수 있으므로, 클라이언트가 분기해야 하는 판단은 이 코드로 한다.
 */
export const MEDIA_ERROR_CODES = [
  "invalid_payload",
  "unknown_method",
  "not_joined",
  "already_joined",
  "room_full",
  "not_found",
  "internal",
] as const;

export const MediaErrorCodeSchema = z.enum(MEDIA_ERROR_CODES);
export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

export const ResponseFrameSchema = z.discriminatedUnion("ok", [
  z.object({ id: RequestIdSchema, ok: z.literal(true), data: z.unknown() }).strict(),
  z
    .object({
      id: RequestIdSchema,
      ok: z.literal(false),
      code: MediaErrorCodeSchema,
      error: z.string(),
    })
    .strict(),
]);

export type ResponseFrame = z.infer<typeof ResponseFrameSchema>;

// 게이트웨이 → 클라이언트 단방향 알림
export const NotificationFrameSchema = z
  .object({
    method: z.string().min(1),
    data: z.unknown(),
  })
  .strict();

export type NotificationFrame = z.infer<typeof NotificationFrameSchema>;

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
