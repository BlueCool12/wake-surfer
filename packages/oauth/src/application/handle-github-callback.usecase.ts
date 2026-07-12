import { parseGithubCallbackParams } from "../infrastructure/github/callback-params";
import type { OAuthCsrfStateStorePort } from "../runtime-deps";

export type OAuthCallbackErrorCode =
  /** 사용자가 GitHub에서 권한 요청을 거부했다. */
  | "ACCESS_DENIED"
  /** 그 외 GitHub이 콜백에 실어 보낸 에러. (원본은 providerError에 보존) */
  | "PROVIDER_ERROR"
  /** 콜백에 state가 없다. (중복/비문자열 파라미터 포함) */
  | "MISSING_STATE"
  /** 저장된 state와 불일치 — CSRF 의심, 만료 또는 재사용. */
  | "STATE_MISMATCH"
  /** error도 없는데 code도 없다. */
  | "MISSING_CODE";

/** GitHub이 콜백 쿼리에 실어 보낸 원본 에러. (로깅·디버깅용 보존) */
export type OAuthProviderError = {
  readonly error: string;
  readonly errorDescription?: string;
};

export type HandleGithubCallbackResult =
  | {
      readonly status: "ok";
      /** state 검증까지 통과한 authorization code. 다음 단계(토큰 교환)의 입력. */
      readonly code: string;
    }
  | {
      readonly status: "rejected";
      readonly reason: OAuthCallbackErrorCode;
      readonly providerError?: OAuthProviderError;
    };

export type HandleGithubCallbackInput = {
  /** 콜백으로 들어온 쿼리. 앱이 req.query 등에서 꺼내 그대로 전달한다. */
  readonly query: Readonly<Record<string, unknown>>;
  readonly stateStore: OAuthCsrfStateStorePort;
};

/**
 * OAuth 콜백 처리 유스케이스.
 *
 * 흐름: state 소비 → error 분기 → state 존재 확인 → 검증 결과 확인 → code 존재 확인 → ok.
 * 예상 가능한 실패는 전부 결과 유니언으로 반환하며 예외를 던지지 않는다.
 * HTTP 상태코드·사용자 문구 매핑은 이 함수를 호출하는 apps의 책임이다.
 */
export async function handleGithubCallback(
  input: HandleGithubCallbackInput,
): Promise<HandleGithubCallbackResult> {
  const params = parseGithubCallbackParams(input.query);

  // 콜백에 도달한 시도의 state는 결과와 무관하게 항상 소진한다.
  const verified = await input.stateStore.verify(params.state ?? "");

  if (params.error !== undefined) {
    return {
      status: "rejected",
      reason: params.error === "access_denied" ? "ACCESS_DENIED" : "PROVIDER_ERROR",
      providerError: {
        error: params.error,
        ...(params.errorDescription !== undefined
          ? { errorDescription: params.errorDescription }
          : {}),
      },
    };
  }

  if (params.state === undefined) {
    return { status: "rejected", reason: "MISSING_STATE" };
  }

  if (!verified) {
    return { status: "rejected", reason: "STATE_MISMATCH" };
  }

  if (params.code === undefined) {
    return { status: "rejected", reason: "MISSING_CODE" };
  }

  return { status: "ok", code: params.code };
}
