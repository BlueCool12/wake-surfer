import {
  ConsumeGatewayTicketResponseSchema,
  type ConsumeGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import {
  InternalSendMessageResponseSchema,
  SendMessageRequestSchema,
  type InternalSendMessageResponse,
  type SendMessageRequest,
} from "@wake-surfer/realtime-chat-message-send-contracts";

export type GatewayApiClient = {
  consumeGatewayTicket: (request: {
    requestId: string;
    signal: AbortSignal;
    ticket: string;
  }) => Promise<ConsumeGatewayTicketResponse>;
  sendMessage: (
    request: SendMessageRequest,
    context: {
      actorId: string;
      requestId: string;
      signal: AbortSignal;
    },
  ) => Promise<InternalSendMessageResponse>;
};

export type CreateGatewayApiClientOptions = {
  actorHeader: string;
  apiBaseUrl: string | URL;
  fetch?: typeof globalThis.fetch;
  gatewayApiToken: string;
  gatewayId: string;
  gatewayIdHeader: string;
  timeoutMilliseconds: number;
};

export function createGatewayApiClient(options: CreateGatewayApiClientOptions): GatewayApiClient {
  const apiBaseUrl = new URL(options.apiBaseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new TypeError("Gateway API client에 fetch 구현이 필요합니다.");
  }

  return {
    async consumeGatewayTicket(request) {
      const value = await requestJson(
        new URL("internal/realtime-chat/gateway-tickets/consume", apiBaseUrl),
        {
          body: { ticket: request.ticket },
          context: request,
          fetchImplementation,
          headers: createInternalHeaders(options, request.requestId),
          timeoutMilliseconds: options.timeoutMilliseconds,
        },
      );
      const parsed = ConsumeGatewayTicketResponseSchema.safeParse(value);

      if (!parsed.success) {
        throw new Error("게이트웨이 티켓 소비 응답 형식이 올바르지 않습니다.");
      }

      return parsed.data;
    },
    async sendMessage(request, context) {
      const parsedRequest = SendMessageRequestSchema.parse(request);
      const value = await requestJson(new URL("internal/realtime-chat/messages", apiBaseUrl), {
        body: parsedRequest,
        context,
        fetchImplementation,
        headers: {
          ...createInternalHeaders(options, context.requestId),
          [options.actorHeader]: context.actorId,
        },
        timeoutMilliseconds: options.timeoutMilliseconds,
      });
      const parsed = InternalSendMessageResponseSchema.safeParse(value);

      if (!parsed.success) {
        throw new Error("메시지 전송 응답 형식이 올바르지 않습니다.");
      }

      return parsed.data;
    },
  };
}

function createInternalHeaders(
  options: CreateGatewayApiClientOptions,
  requestId: string,
): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${options.gatewayApiToken}`,
    "content-type": "application/json",
    [options.gatewayIdHeader]: options.gatewayId,
    "x-request-id": requestId,
  };
}

async function requestJson(
  url: URL,
  options: {
    body: unknown;
    context: { requestId: string; signal: AbortSignal };
    fetchImplementation: typeof globalThis.fetch;
    headers: Record<string, string>;
    timeoutMilliseconds: number;
  },
): Promise<unknown> {
  const timeout = createTimeoutSignal(options.context.signal, options.timeoutMilliseconds);

  try {
    const response = await options.fetchImplementation(url, {
      body: JSON.stringify(options.body),
      headers: options.headers,
      method: "POST",
      signal: timeout.signal,
    });
    const rawBody = await response.text();
    let value: unknown;

    try {
      value = JSON.parse(rawBody) as unknown;
    } catch {
      throw new Error(`Gateway API 응답이 JSON이 아닙니다: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`Gateway API 요청이 실패했습니다: ${response.status}`);
    }

    return value;
  } finally {
    timeout.dispose();
  }
}

function createTimeoutSignal(
  parentSignal: AbortSignal,
  timeoutMilliseconds: number,
): {
  dispose: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(parentSignal.reason);

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(new Error("Gateway API request timed out"));
  }, timeoutMilliseconds);
  timer.unref();

  return {
    dispose: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
  };
}
