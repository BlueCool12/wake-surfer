import { z } from "zod";

/**
 * 한 프레임의 최대 크기.
 *
 * mediasoup의 RTP capabilities는 코덱·헤더 확장 목록을 통째로 실어 채팅 메시지보다 훨씬 크다.
 * 게이트웨이 WebSocket 상한을 이 값에 맞춘다.
 */
export const MAX_FRAME_UTF8_BYTES = 262_144;

export const RequestIdSchema = z.number().int().positive();

// 클라이언트 → 게이트웨이 요청
/**
 * method 이름의 최대 길이.
 *
 * 봉투 단계에서는 이름을 아는 method로 한정하지 않으므로(아래 참고) 길이 상한이 필요하다.
 * 없으면 클라이언트가 보낸 긴 문자열이 "알 수 없는 method: ..." 응답에 그대로 되돌아간다.
 */
export const MAX_METHOD_LENGTH = 64;

/**
 * 클라이언트 → 게이트웨이 요청 봉투.
 *
 * `method`를 아는 이름으로 한정하지 않는 것은 의도적이다. 이 스키마가 답하는 질문은
 * **"응답할 수 있는가"**(= `id`가 있는가)이지 "이해할 수 있는가"가 아니다. 모르는 method를
 * 여기서 걸러내면 `id`를 잃어 오류 응답을 못 보내고 연결을 끊는 수밖에 없는데, 그건 버전이
 * 어긋난 클라이언트의 프레임 하나 때문에 통화 제어 채널을 죽이는 셈이다.
 * 이름 검증은 `parseMediaRequestFrame`이 맡는다.
 */
export const RequestFrameSchema = z
  .object({
    id: RequestIdSchema,
    method: z.string().min(1).max(MAX_METHOD_LENGTH),
    data: z.unknown().optional(),
  })
  .strict();

export type RequestFrame = z.infer<typeof RequestFrameSchema>;

// 게이트웨이 → 클라이언트 응답
export const ResponseFrameSchema = z.discriminatedUnion("ok", [
  z.object({ id: RequestIdSchema, ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ id: RequestIdSchema, ok: z.literal(false), error: z.string() }).strict(),
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
