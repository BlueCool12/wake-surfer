/**
 * 우리 서비스가 인증한 회원의 최소 표현. (순수)
 *
 * GitHub이 준 정보(`GithubUser`)와 구분되는 "우리 쪽 신원"이다.
 * JWT `sub`에 담기므로 id는 문자열이다. (RFC 7519 sub은 문자열)
 * DB가 숫자 PK를 쓰면 어댑터 경계에서 문자열화한다.
 */
export type AuthenticatedUser = {
  readonly id: string;
};
