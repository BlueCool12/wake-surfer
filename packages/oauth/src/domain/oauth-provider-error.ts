/**
 * OAuth 프로바이더가 보낸 원본 에러의 형태와 검역 규칙. (RFC 6749 기반, 순수)
 *
 * 콜백 쿼리와 토큰 교환 응답이 같은 error/error_description 형태를 쓰므로 여기에 모은다.
 * 이 값들은 결과(providerError)로 앱에 노출되므로 규격 밖 값은 조작된 입력으로 보고 버린다.
 */
export type OAuthProviderError = {
  readonly error: string;
  readonly errorDescription?: string;
};

/** OAuth 규격(RFC 6749)상 error 코드는 snake_case 토큰이다. (예: access_denied) */
const OAUTH_ERROR_TOKEN = /^[a-z0-9_]{1,64}$/;

/** error_description 허용 범위: 인쇄 가능 ASCII, 최대 256자. */
const PRINTABLE_ASCII = /^[\x20-\x7E]{1,256}$/;

/** HTML 문맥에서 위험한 문자 — RFC 문자셋보다 보수적으로 추가 배제한다. */
const HTML_SENSITIVE = /[<>&"'`\\]/;

/** OAuth error 토큰 형식이 아니면 undefined. */
export function sanitizeProviderErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && OAUTH_ERROR_TOKEN.test(value) ? value : undefined;
}

/** 인쇄 가능 ASCII 256자 이내 + HTML 위험 문자 없음이 아니면 undefined. */
export function sanitizeProviderErrorDescription(value: unknown): string | undefined {
  return typeof value === "string" && PRINTABLE_ASCII.test(value) && !HTML_SENSITIVE.test(value)
    ? value
    : undefined;
}
