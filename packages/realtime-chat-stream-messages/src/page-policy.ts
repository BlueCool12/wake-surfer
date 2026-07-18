import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  FinalEnvelopeMeasurement,
  FinalEnvelopeMeasurer,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import { StreamMessagesDataIntegrityError } from "./errors.js";

export type MeasuredPage<Response> = {
  response: Response;
  envelopeUtf8ByteLength: number;
};

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
