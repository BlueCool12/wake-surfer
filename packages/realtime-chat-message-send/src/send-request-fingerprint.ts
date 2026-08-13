import type { MessageTarget } from "@wake-surfer/realtime-chat-message-send-contracts";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createPersistedTextMessageContent } from "./persisted-message-content";
import { getSendMessageTargetId, getSendMessageTargetType } from "./message-send";

const SEND_REQUEST_CANONICALIZATION_VERSION = 1;
const SEND_REQUEST_FINGERPRINT_ALGORITHM = "sha256";

const SendRequestFingerprintSchema = z.strictObject({
  canonicalizationVersion: z.literal(SEND_REQUEST_CANONICALIZATION_VERSION),
  algorithm: z.literal(SEND_REQUEST_FINGERPRINT_ALGORITHM),
  keyId: z.null(),
  value: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0),
});

export type SendRequestFingerprint = Readonly<z.infer<typeof SendRequestFingerprintSchema>>;

export function createSendRequestFingerprint(
  target: MessageTarget,
  normalizedText: string,
): SendRequestFingerprint {
  const canonicalPayload = JSON.stringify({
    target: {
      type: getSendMessageTargetType(target),
      id: getSendMessageTargetId(target),
    },
    content: createPersistedTextMessageContent(normalizedText),
  });

  return {
    canonicalizationVersion: SEND_REQUEST_CANONICALIZATION_VERSION,
    algorithm: SEND_REQUEST_FINGERPRINT_ALGORITHM,
    keyId: null,
    value: createHash(SEND_REQUEST_FINGERPRINT_ALGORITHM).update(canonicalPayload).digest(),
  };
}

export function matchesSendRequestFingerprint(
  left: SendRequestFingerprint,
  right: SendRequestFingerprint,
): boolean {
  if (
    left.canonicalizationVersion !== right.canonicalizationVersion ||
    left.algorithm !== right.algorithm ||
    left.keyId !== right.keyId ||
    left.value.byteLength !== right.value.byteLength
  ) {
    return false;
  }

  return timingSafeEqual(left.value, right.value);
}

export function parseSendRequestFingerprint(input: {
  canonicalizationVersion: number;
  algorithm: string;
  keyId: string | null;
  value: Uint8Array;
}): SendRequestFingerprint {
  const result = SendRequestFingerprintSchema.safeParse(input);

  if (!result.success) {
    throw new Error("저장된 send request fingerprint scheme이 지원되지 않습니다.", {
      cause: result.error,
    });
  }

  return {
    ...result.data,
    value: new Uint8Array(result.data.value),
  };
}
