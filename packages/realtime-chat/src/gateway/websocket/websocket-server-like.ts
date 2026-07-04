export type WebSocketMessagePayload = string | Uint8Array | ArrayBuffer;

export type WebSocketConnectionLike = {
  id?: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  send: (payload: string) => void | Promise<void>;
  close: (code?: number, reason?: string) => void | Promise<void>;
  onMessage: (
    handler: (payload: WebSocketMessagePayload) => void | Promise<void>
  ) => void;
  onClose: (handler: () => void | Promise<void>) => void;
};

export type WebSocketRouteDefinition = {
  path: string;
  onConnection: (connection: WebSocketConnectionLike) => void | Promise<void>;
};

export type WebSocketServerLike = {
  route: (definition: WebSocketRouteDefinition) => void | Promise<void>;
};
