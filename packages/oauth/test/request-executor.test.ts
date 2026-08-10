import { describe, expect, it } from "vitest";

import { createGithubRequestExecutor } from "../src/infrastructure/github/request-executor";

describe("createGithubRequestExecutor.executeJson", () => {
  it("응답의 ok·status와 파싱된 body를 돌려준다", async () => {
    const fetchLike = (async () =>
      new Response(JSON.stringify({ hello: "world" }), { status: 200 })) as typeof globalThis.fetch;
    const executor = createGithubRequestExecutor({ fetch: fetchLike });
    const result = await executor.executeJson({ url: "https://api.example.com" });
    expect(result).toEqual({ ok: true, status: 200, body: { hello: "world" } });
  });

  it("url·method·headers·body를 fetch로 전달한다", async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchLike = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    const executor = createGithubRequestExecutor({ fetch: fetchLike });

    await executor.executeJson({
      url: "https://api.example.com/x",
      method: "POST",
      headers: { Accept: "application/json" },
      body: "payload",
    });

    const call = seen[0]!;
    expect(call.url).toBe("https://api.example.com/x");
    expect(call.init?.method).toBe("POST");
    expect(new Headers(call.init?.headers).get("Accept")).toBe("application/json");
    expect(call.init?.body).toBe("payload");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("비200 응답도 예외 없이 ok:false와 status로 반환한다", async () => {
    const fetchLike = (async () =>
      new Response(JSON.stringify({ message: "nope" }), {
        status: 403,
      })) as typeof globalThis.fetch;
    const executor = createGithubRequestExecutor({ fetch: fetchLike });
    const result = await executor.executeJson({ url: "https://api.example.com" });
    expect(result).toEqual({ ok: false, status: 403, body: { message: "nope" } });
  });

  it("JSON 파싱이 실패하면 body는 undefined다", async () => {
    const fetchLike = (async () =>
      new Response("not json", { status: 200 })) as typeof globalThis.fetch;
    const executor = createGithubRequestExecutor({ fetch: fetchLike });
    const result = await executor.executeJson({ url: "https://api.example.com" });
    expect(result).toEqual({ ok: true, status: 200, body: undefined });
  });

  it("네트워크 예외는 그대로 전파한다 (정규화하지 않음)", async () => {
    const fetchLike = (async () => {
      throw new Error("network down");
    }) as typeof globalThis.fetch;
    const executor = createGithubRequestExecutor({ fetch: fetchLike });
    await expect(executor.executeJson({ url: "https://api.example.com" })).rejects.toThrow(
      /network down/,
    );
  });
});
