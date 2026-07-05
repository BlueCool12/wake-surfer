import type {
  ConsumeGatewayTicketResponse,
  IssueGatewayTicketResponse,
  MarkReadCursorRequest,
  MarkReadCursorResponse,
  MessageCommandResponse,
  ReplyThreadMessageRequest,
  SendChannelMessageRequest,
  SendDMMessageRequest,
  SyncStreamMessagesRequest,
  SyncStreamMessagesResponse
} from '@wake-surfer/realtime-chat-contracts';
import type {
  GatewayTicketConsumePort,
  RealtimeChatApiClientPort
} from '@wake-surfer/realtime-chat/gateway';

export function createHttpRealtimeChatApiClient(
  apiBaseUrl: string
): RealtimeChatApiClientPort {
  const baseUrl = normalizeBaseUrl(apiBaseUrl);

  return {
    issueGatewayTicket(input) {
      return postJson<IssueGatewayTicketResponse>(
        baseUrl,
        '/gateway-tickets',
        input
      );
    },
    sendChannelMessage(request) {
      return postJson<MessageCommandResponse>(
        baseUrl,
        '/internal/messages/channel',
        request
      );
    },
    sendDMMessage(request) {
      return postJson<MessageCommandResponse>(
        baseUrl,
        '/internal/messages/dm',
        request
      );
    },
    replyThreadMessage(request) {
      return postJson<MessageCommandResponse>(
        baseUrl,
        '/internal/messages/thread-replies',
        request
      );
    },
    markReadCursor(request) {
      return postJson<MarkReadCursorResponse>(
        baseUrl,
        '/internal/read-cursors',
        request
      );
    },
    syncStreamMessages(request) {
      return getJson<SyncStreamMessagesResponse>(
        buildSyncMessagesUrl(baseUrl, request)
      );
    }
  };
}

export function createHttpGatewayTicketConsumePort(
  apiBaseUrl: string
): GatewayTicketConsumePort {
  const baseUrl = normalizeBaseUrl(apiBaseUrl);

  return {
    consume(ticketValue) {
      return postJson<ConsumeGatewayTicketResponse>(
        baseUrl,
        '/internal/gateway-tickets/consume',
        {
          ticket: ticketValue
        }
      );
    }
  };
}

async function postJson<T>(
  baseUrl: string,
  suffix: string,
  body: unknown
): Promise<T> {
  const response = await fetch(`${baseUrl}${suffix}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return readJsonResponse<T>(response);
}

async function getJson<T>(url: string): Promise<T> {
  return readJsonResponse<T>(await fetch(url));
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(
      `realtime chat api request failed: ${response.status} ${JSON.stringify(body)}`
    );
  }

  return body as T;
}

function buildSyncMessagesUrl(
  baseUrl: string,
  request: SyncStreamMessagesRequest
): string {
  const url = new URL(
    `${baseUrl}/streams/${encodeURIComponent(request.streamId)}/messages`
  );

  url.searchParams.set('requestId', request.requestId);
  url.searchParams.set('actorId', request.actorId);

  if (request.afterSequence !== undefined) {
    url.searchParams.set('afterSequence', String(request.afterSequence));
  }

  if (request.beforeSequence !== undefined) {
    url.searchParams.set('beforeSequence', String(request.beforeSequence));
  }

  if (request.limit !== undefined) {
    url.searchParams.set('limit', String(request.limit));
  }

  return url.toString();
}

function normalizeBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
