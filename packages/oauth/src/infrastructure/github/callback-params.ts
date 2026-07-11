/**
 * GitHub OAuth 콜백 쿼리 파라미터 파싱. (GitHub wire 규격 지식)
 *
 * 프레임워크가 주는 쿼리 값은 string | string[] | undefined 등으로 느슨하므로,
 * 문자열이 아니거나 중복(배열)이거나 빈 값이면 "없는 것"으로 취급한다. (parameter pollution 방어)
 *
 * error 계열 값은 결과(providerError)로 앱에 노출되므로 규격 기반으로 검역한다.
 * 규격 밖 값은 조작된 입력으로 보고 "없는 것"으로 취급한다. (XSS·로그 오염 심층 방어)
 */
export type GithubCallbackParams = {
  readonly code?: string;
  readonly state?: string;
  readonly error?: string;
  readonly errorDescription?: string;
};

/** OAuth 규격(RFC 6749)상 error 코드는 snake_case 토큰이다. (예: access_denied) */
const OAUTH_ERROR_TOKEN = /^[a-z0-9_]{1,64}$/;

/** error_description 허용 범위: 인쇄 가능 ASCII, 최대 256자. */
const PRINTABLE_ASCII = /^[\x20-\x7E]{1,256}$/;

/** HTML 문맥에서 위험한 문자 — RFC 문자셋보다 보수적으로 추가 배제한다. */
const HTML_SENSITIVE = /[<>&"'`\\]/;

/** 쿼리에서 단일 문자열 값만 골라낸다. 배열/비문자열/빈 문자열은 undefined. */
function pickString(query: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = query[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** OAuth error 토큰 형식이 아니면 없는 것으로 취급한다. */
function pickErrorToken(query: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = pickString(query, key);
  return value !== undefined && OAUTH_ERROR_TOKEN.test(value) ? value : undefined;
}

/** 인쇄 가능 ASCII 256자 이내 + HTML 위험 문자 없음이 아니면 없는 것으로 취급한다. */
function pickErrorDescription(
  query: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = pickString(query, key);
  return value !== undefined && PRINTABLE_ASCII.test(value) && !HTML_SENSITIVE.test(value)
    ? value
    : undefined;
}

/** 콜백 쿼리(req.query 등)에서 GitHub OAuth 파라미터를 추출한다. (순수 함수) */
export function parseGithubCallbackParams(
  query: Readonly<Record<string, unknown>>,
): GithubCallbackParams {
  const code = pickString(query, "code");
  const state = pickString(query, "state");
  const error = pickErrorToken(query, "error");
  const errorDescription = pickErrorDescription(query, "error_description");
  return {
    ...(code !== undefined ? { code } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(errorDescription !== undefined ? { errorDescription } : {}),
  };
}
