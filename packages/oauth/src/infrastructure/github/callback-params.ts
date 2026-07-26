import {
  sanitizeProviderErrorCode,
  sanitizeProviderErrorDescription,
} from "../../domain/oauth-provider-error";

/**
 * GitHub OAuth 콜백 쿼리 파라미터 파싱. (GitHub wire 규격 지식)
 *
 * 프레임워크가 주는 쿼리 값은 string | string[] | undefined 등으로 느슨하므로,
 * 문자열이 아니거나 중복(배열)이거나 빈 값이면 "없는 것"으로 취급한다. (parameter pollution 방어)
 * error 계열 값은 oauth-provider-error의 검역 규칙을 거쳐, 규격 밖 값도 "없는 것"으로 취급한다.
 */
export type GithubCallbackParams = {
  readonly code?: string;
  readonly state?: string;
  readonly error?: string;
  readonly errorDescription?: string;
};

/** 쿼리에서 단일 문자열 값만 골라낸다. 배열/비문자열/빈 문자열은 undefined. */
function pickString(query: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = query[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 콜백 쿼리(req.query 등)에서 GitHub OAuth 파라미터를 추출한다. (순수 함수) */
export function parseGithubCallbackParams(
  query: Readonly<Record<string, unknown>>,
): GithubCallbackParams {
  const code = pickString(query, "code");
  const state = pickString(query, "state");
  const error = sanitizeProviderErrorCode(pickString(query, "error"));
  const errorDescription = sanitizeProviderErrorDescription(pickString(query, "error_description"));
  return {
    ...(code !== undefined ? { code } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(errorDescription !== undefined ? { errorDescription } : {}),
  };
}
