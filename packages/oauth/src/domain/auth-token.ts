/**
 * 우리 서비스 JWT의 클레임 계약과 토큰 묶음. (순수)
 *
 * 서명 알고리즘·수명·저장위치는 apps 소관이고, 여기서는 "무엇을 담는가"만 정의한다.
 * 개인정보(이메일·이름)는 담지 않는다 — 토큰 본문은 누구나 열어볼 수 있다(암호화 아님).
 */

export type AuthTokenType = "access" | "refresh";

export type AuthTokenClaims = {
  /** 우리 회원 id. (GitHub id 아님) */
  readonly sub: string;
  readonly type: AuthTokenType;
  /** 발급 시각(epoch seconds). */
  readonly iat: number;
  /** 만료 시각(epoch seconds). */
  readonly exp: number;
};

export type AuthTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
};
