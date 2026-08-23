import { z } from "zod";

/**
 * 한 프레임의 최대 크기.
 *
 * mediasoup의 RTP capabilities는 코덱·헤더 확장 목록을 통째로 실어 채팅 메시지보다 훨씬 크다.
 * 게이트웨이 WebSocket 상한을 이 값에 맞춘다.
 */
export const MAX_FRAME_UTF8_BYTES = 262_144;

export const RequestIdSchema = z.number().int().positive();

/**
 * 클라이언트 → 게이트웨이 요청 봉투.
 *
 * `data`의 형태는 method마다 다르므로 여기서는 열어두고, `parseMediaRequest`가 method를 좁힌 뒤
 * 해당 스키마로 검증한다.
 */
export const RequestFrameSchema = z
  .object({
    id: RequestIdSchema,
    method: z.string().min(1),
    data: z.unknown().optional(),
  })
  .strict();

export type RequestFrame = z.infer<typeof RequestFrameSchema>;

/** 게이트웨이 → 클라이언트 응답 봉투. 요청의 `id`를 되돌려 상관관계를 맺는다. */
export const ResponseFrameSchema = z.discriminatedUnion("ok", [
  z.object({ id: RequestIdSchema, ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ id: RequestIdSchema, ok: z.literal(false), error: z.string() }).strict(),
]);

export type ResponseFrame = z.infer<typeof ResponseFrameSchema>;

/** 게이트웨이 → 클라이언트 단방향 알림. 대응하는 요청이 없으므로 `id`가 없다. */
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
