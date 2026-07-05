import { Hono } from "hono";
import type {
  HttpRequestLike,
  HttpResponseLike,
  HttpServerLike,
} from "@wake-surfer/realtime-chat/api";

export type HonoHttpServer = HttpServerLike & {
  app: Hono;
};

export function createHonoHttpServer(): HonoHttpServer {
  const app = new Hono();

  return {
    app,
    route(definition) {
      if (definition.method === "GET") {
        app.get(definition.path, async (context) =>
          toResponse(
            await definition.handler({
              params: context.req.param(),
              query: context.req.query(),
              headers: headersToRecord(context.req.raw.headers),
            }),
          ),
        );
        return;
      }

      app.post(definition.path, async (context) =>
        toResponse(
          await definition.handler({
            params: context.req.param(),
            query: context.req.query(),
            headers: headersToRecord(context.req.raw.headers),
            body: await parseJsonBody(context.req.raw),
          }),
        ),
      );
    },
  };
}

function toResponse(response: HttpResponseLike): Response {
  if (response.body === undefined) {
    return new Response(null, {
      status: response.status,
    });
  }

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function parseJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();

  if (text.trim() === "") {
    return undefined;
  }

  return JSON.parse(text);
}

function headersToRecord(headers: Headers): HttpRequestLike["headers"] {
  const record: Record<string, string | undefined> = {};

  for (const [key, value] of headers.entries()) {
    record[key.toLowerCase()] = value;
  }

  return record;
}
