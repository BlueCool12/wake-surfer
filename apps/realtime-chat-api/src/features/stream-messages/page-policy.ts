import {
  getCanonicalStreamId,
  type MessageTarget,
  type PublicMessage,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  FinalEnvelopeMeasurement,
  FinalEnvelopeMeasurer,
  LatestStreamMessagesResponse,
  OlderStreamMessagesResponse,
  SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import {
  type LatestMessagesPage,
  type OlderMessagesPage,
  type StreamMessage,
  type SyncAfterMessagesPage,
} from "@wake-surfer/realtime-chat-stream-messages";

export type StreamMessagesEnvelopeIntegrityReason =
  "oversized_row" | "invalid_envelope_measurement";

export class StreamMessagesEnvelopeIntegrityError extends Error {
  readonly reason: StreamMessagesEnvelopeIntegrityReason;
  readonly metadata: Readonly<Record<string, number | string>>;

  constructor(
    reason: StreamMessagesEnvelopeIntegrityReason,
    metadata: Readonly<Record<string, number | string>>,
  ) {
    super(`Stream Messages envelope 무결성 검증에 실패했습니다: ${reason}`);
    this.name = "StreamMessagesEnvelopeIntegrityError";
    this.reason = reason;
    this.metadata = metadata;
  }
}

export type MeasuredPage<Response> = {
  response: Response;
  envelopeUtf8ByteLength: number;
};

export function fitLatestMessagesPage(
  target: MessageTarget,
  page: LatestMessagesPage,
  measureFinalEnvelope: FinalEnvelopeMeasurer<LatestStreamMessagesResponse>,
): MeasuredPage<LatestStreamMessagesResponse> {
  const transport = toPublicMessages(target, page.messages);

  return fitNewestContiguousMessages({
    messages: transport.messages,
    buildResponse: (messages) => {
      const oldest = messages[0];

      return {
        streamId: transport.streamId,
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
  target: MessageTarget,
  page: OlderMessagesPage,
  measureFinalEnvelope: FinalEnvelopeMeasurer<OlderStreamMessagesResponse>,
): MeasuredPage<OlderStreamMessagesResponse> {
  const transport = toPublicMessages(target, page.messages);

  return fitNewestContiguousMessages({
    messages: transport.messages,
    buildResponse: (messages) => {
      const oldest = messages[0];

      return {
        streamId: transport.streamId,
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
  target: MessageTarget,
  page: SyncAfterMessagesPage,
  measureFinalEnvelope: FinalEnvelopeMeasurer<SyncAfterStreamMessagesResponse>,
): MeasuredPage<SyncAfterStreamMessagesResponse> {
  const transport = toPublicMessages(target, page.messages);

  return fitOldestContiguousMessages({
    messages: transport.messages,
    buildResponse: (messages) => {
      const newest = messages.at(-1);
      const nextAfterSequence = newest?.sequence ?? page.throughSequence;

      return {
        streamId: transport.streamId,
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
      throw new StreamMessagesEnvelopeIntegrityError("invalid_envelope_measurement", {
        utf8ByteLength: measurement.utf8ByteLength,
      });
    }

    if (messages.length === 1) {
      const message = messages[0]!;

      throw new StreamMessagesEnvelopeIntegrityError("oversized_row", {
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
    throw new StreamMessagesEnvelopeIntegrityError("invalid_envelope_measurement", {
      utf8ByteLength: String(measurement.utf8ByteLength),
    });
  }
}

function toPublicMessages(
  target: MessageTarget,
  messages: readonly StreamMessage[],
): {
  streamId: string;
  messages: PublicMessage[];
} {
  const streamId = getCanonicalStreamId(target);

  return {
    streamId,
    messages: messages.map((message) => {
      const publicMessageMetadata = {
        messageId: message.messageId,
        streamId: getCanonicalStreamId(message.target),
        sequence: message.sequence,
        senderActorId: message.senderActorId,
        target: message.target,
        createdAt: message.createdAt.toISOString(),
      };
      const publicMessage: PublicMessage =
        message.content === null
          ? {
              ...publicMessageMetadata,
              content: null,
              deletedAt: message.deletedAt.toISOString(),
            }
          : {
              ...publicMessageMetadata,
              content: message.content,
              ...(message.editedAt === undefined
                ? {}
                : { editedAt: message.editedAt.toISOString() }),
            };

      return message.sentAtClient === undefined
        ? publicMessage
        : {
            ...publicMessage,
            sentAtClient: message.sentAtClient.toISOString(),
          };
    }),
  };
}
