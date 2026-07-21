import { z } from "zod";

import { RequestIdSchema } from "./common.js";

export type StreamMessagesDomainRejectionCode =
  "stream_unavailable" | "invalid_cursor" | "bad_request" | "rate_limited";

export type StreamMessagesRetryableFailureCode = "stream_messages_unavailable";

export type StreamMessagesErrorCode =
  StreamMessagesDomainRejectionCode | StreamMessagesRetryableFailureCode;

const ErrorMessageSchema = z.string().trim().min(1);
const RetryAfterMsSchema = z.number().int().safe().positive();

export const StreamMessagesHttpErrorResponseSchema = z.discriminatedUnion("code", [
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("stream_unavailable"),
    message: ErrorMessageSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("invalid_cursor"),
    message: ErrorMessageSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("bad_request"),
    message: ErrorMessageSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("rate_limited"),
    message: ErrorMessageSchema,
    retryAfterMs: RetryAfterMsSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("stream_messages_unavailable"),
    message: ErrorMessageSchema,
    retryable: z.literal(true),
  }),
]);

export type StreamMessagesHttpErrorResponse = z.infer<typeof StreamMessagesHttpErrorResponseSchema>;

export const ChatStreamSyncRejectedEventSchema = z.discriminatedUnion("code", [
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("stream_unavailable"),
  }),
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("invalid_cursor"),
  }),
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("bad_request"),
  }),
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("rate_limited"),
    retryAfterMs: RetryAfterMsSchema,
  }),
]);

export type ChatStreamSyncRejectedEvent = z.infer<typeof ChatStreamSyncRejectedEventSchema>;

export const ChatStreamSyncFailedEventSchema = z.strictObject({
  requestId: RequestIdSchema,
  code: z.literal("stream_messages_unavailable"),
  retryable: z.literal(true),
});

export type ChatStreamSyncFailedEvent = z.infer<typeof ChatStreamSyncFailedEventSchema>;
