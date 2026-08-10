import { DEFAULT_GITHUB_TIMEOUT_MS } from "./endpoints";

/**
 * GitHub 통신의 전송 계층. fetch 해석·타임아웃·JSON 파싱을 한곳에서 처리한다.
 *
 * 응답 규격 해석(토큰 응답인지 사용자 응답인지)은 각 클라이언트가 담당한다.
 * network·timeout 예외는 정규화하지 않고 그대로 전파한다. (기존 인프라 오류 계약 유지)
 */
export type GithubRequest = {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Record<string, string>;
  readonly body?: RequestInit["body"];
};

export type GithubResponse = {
  readonly ok: boolean;
  readonly status: number;
  /** JSON 파싱 결과. 파싱 실패 시 undefined. */
  readonly body: unknown;
};

export type GithubRequestExecutor = {
  executeJson: (request: GithubRequest) => Promise<GithubResponse>;
};

export type GithubRequestExecutorConfig = {
  /** 테스트 주입용. 기본은 내장 fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
};

export function createGithubRequestExecutor(
  config: GithubRequestExecutorConfig = {},
): GithubRequestExecutor {
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;

  return {
    async executeJson(request) {
      const init: RequestInit = {
        signal: AbortSignal.timeout(timeoutMs),
        ...(request.method !== undefined ? { method: request.method } : {}),
        ...(request.headers !== undefined ? { headers: request.headers } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
      };
      const response = await doFetch(request.url, init);
      const body: unknown = await response.json().catch(() => undefined);
      return { ok: response.ok, status: response.status, body };
    },
  };
}
