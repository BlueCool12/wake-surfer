import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  FinalEnvelopeMeasurement,
  FinalEnvelopeMeasurer,
  LatestStreamMessagesResponse,
  OlderStreamMessagesResponse,
  SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import { StreamMessagesDataIntegrityError } from "./errors.js";
import type { LatestMessagesPage } from "./usecases/load-latest/load-latest.usecase.js";
import type { OlderMessagesPage } from "./usecases/load-older/load-older.usecase.js";
import type { SyncAfterMessagesPage } from "./usecases/sync-after/sync-after.usecase.js";

export type MeasuredPage<Response> = {
  response: Response;
  envelopeUtf8ByteLength: number;
};

export function fitLatestMessagesPage(
  page: LatestMessagesPage,
  measureFinalEnvelope: FinalEnvelopeMeasurer<LatestStreamMessagesResponse>,
): MeasuredPage<LatestStreamMessagesResponse> {
  return fitNewestContiguousMessages({
    messages: page.messages,
    buildResponse: (messages) => {
      const oldest = messages[0];

      return {
        streamId: page.streamId,
        throughSequence: page.throughSequence,
        messages,
        nextBeforeSequence: oldest?.sequence ?? null,
        hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
      };
    },
    measureFinalEnvelope,
  });
}

export function fitOlderMessagesPage(
  page: OlderMessagesPage,
  measureFinalEnvelope: FinalEnvelopeMeasurer<OlderStreamMessagesResponse>,
): MeasuredPage<OlderStreamMessagesResponse> {
  return fitNewestContiguousMessages({
    messages: page.messages,
    buildResponse: (messages) => {
      const oldest = messages[0];

      return {
        streamId: page.streamId,
        beforeSequence: page.beforeSequence,
        messages,
        nextBeforeSequence: oldest?.sequence ?? null,
        hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
      };
    },
    measureFinalEnvelope,
  });
}

export function fitSyncAfterMessagesPage(
  page: SyncAfterMessagesPage,
  measureFinalEnvelope: FinalEnvelopeMeasurer<SyncAfterStreamMessagesResponse>,
): MeasuredPage<SyncAfterStreamMessagesResponse> {
  return fitOldestContiguousMessages({
    messages: page.messages,
    buildResponse: (messages) => {
      const newest = messages.at(-1);
      const nextAfterSequence = newest?.sequence ?? page.throughSequence;

      return {
        streamId: page.streamId,
        afterSequence: page.afterSequence,
        throughSequence: page.throughSequence,
        messages,
        nextAfterSequence,
        hasMoreAfter: nextAfterSequence < page.throughSequence,
      };
    },
    measureFinalEnvelope,
  });
}

export function fitNewestContiguousMessages<Response>(input: {
  messages: readonly PublicMessage[];
  buildResponse: (messages: PublicMessage[]) => Response;
  measureFinalEnvelope: FinalEnvelopeMeasurer<Response>;
}): MeasuredPage<Response> {
  return fitContiguousMessages({
    ...input,
    removeMessage: (messages) => messages.slice(1),
  });
}

export function fitOldestContiguousMessages<Response>(input: {
  messages: readonly PublicMessage[];
  buildResponse: (messages: PublicMessage[]) => Response;
  measureFinalEnvelope: FinalEnvelopeMeasurer<Response>;
}): MeasuredPage<Response> {
  return fitContiguousMessages({
    ...input,
    removeMessage: (messages) => messages.slice(0, -1),
  });
}

function fitContiguousMessages<Response>(input: {
  messages: readonly PublicMessage[];
  buildResponse: (messages: PublicMessage[]) => Response;
  measureFinalEnvelope: FinalEnvelopeMeasurer<Response>;
  removeMessage: (messages: PublicMessage[]) => PublicMessage[];
}): MeasuredPage<Response> {
  let messages = [...input.messages];

  while (true) {
    const response = input.buildResponse(messages);
    const measurement = input.measureFinalEnvelope(response);
    assertValidMeasurement(measurement);

    if (measurement.isWithinLimit) {
      return {
        response,
        envelopeUtf8ByteLength: measurement.utf8ByteLength,
      };
    }

    if (messages.length === 0) {
      throw new StreamMessagesDataIntegrityError("invalid_envelope_measurement", {
        utf8ByteLength: measurement.utf8ByteLength,
      });
    }

    if (messages.length === 1) {
      const message = messages[0]!;

      throw new StreamMessagesDataIntegrityError("oversized_row", {
        messageId: message.messageId,
        streamId: message.streamId,
        sequence: message.sequence,
        utf8ByteLength: measurement.utf8ByteLength,
      });
    }

    messages = input.removeMessage(messages);
  }
}

function assertValidMeasurement(measurement: FinalEnvelopeMeasurement): void {
  if (!Number.isSafeInteger(measurement.utf8ByteLength) || measurement.utf8ByteLength < 0) {
    throw new StreamMessagesDataIntegrityError("invalid_envelope_measurement", {
      utf8ByteLength: String(measurement.utf8ByteLength),
    });
  }
}
