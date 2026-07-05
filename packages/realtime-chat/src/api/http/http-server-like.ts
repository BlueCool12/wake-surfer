export type HttpMethod = "GET" | "POST";

export type HttpRequestLike = {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body?: unknown;
};

export type HttpResponseLike = {
  status: number;
  body?: unknown;
};

export type HttpRouteHandler = (
  request: HttpRequestLike,
) => HttpResponseLike | Promise<HttpResponseLike>;

export type HttpRouteDefinition = {
  method: HttpMethod;
  path: string;
  handler: HttpRouteHandler;
};

export type HttpServerLike = {
  route: (definition: HttpRouteDefinition) => void | Promise<void>;
};
