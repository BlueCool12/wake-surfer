import { createHmac, timingSafeEqual } from "node:crypto";

import type { OAuthCsrfStateStorePort } from "../../runtime-deps";

export type SameSite = "Strict" | "Lax" | "None";

export type CookieAttributes = {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: SameSite;
  readonly path: string;
  /** 쿠키 수명(초). 0이면 즉시 만료(삭제)를 뜻한다. */
  readonly maxAge: number;
};

/**
 * 프레임워크 비종속 최소 쿠키 인터페이스.
 *
 * 이 패키지는 특정 웹 프레임워크에 의존하지 않으므로, 쿠키 읽기/쓰기의 실제 동작은
 * 이 패키지를 쓰는 `apps/` 서버가 자신의 프레임워크(Express·Hono 등) req/res에 맞춰
 * 구현해 주입한다. (요청마다 바인딩)
 */
export type CookieJar = {
  get: (name: string) => string | undefined;
  set: (name: string, value: string, attributes: CookieAttributes) => void;
};

export type CookieStateStoreConfig = {
  readonly cookies: CookieJar;
  /** HMAC 서명 키. apps가 환경변수 등에서 주입한다. (비어 있으면 예외) */
  readonly secret: string;
  /** 쿠키 이름. 기본 "oauth_state". */
  readonly cookieName?: string;
  /** 쿠키 수명(초). 기본 600(10분). state는 짧게 산다. */
  readonly maxAgeSeconds?: number;
  /** Secure 속성. 기본 true. 로컬 http 테스트 시에만 false. */
  readonly secure?: boolean;
  /** SameSite. 기본 "Lax" (GitHub 콜백의 top-level 이동에도 쿠키가 전달되도록). */
  readonly sameSite?: SameSite;
  readonly path?: string;
};

const DEFAULT_COOKIE_NAME = "oauth_state";
const DEFAULT_MAX_AGE_SECONDS = 600;

/** value에 HMAC 서명을 붙여 `value.signature` 형태로 만든다. */
function sign(value: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${signature}`;
}

/** 서명을 검증하고 원래 value를 돌려준다. 서명이 어긋나면 null. */
function unsign(signed: string, secret: string): string | null {
  const separator = signed.lastIndexOf(".");
  if (separator < 0) return null;
  const value = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(value).digest("base64url");
  if (!timingSafeEqualStr(signature, expected)) return null;
  return value;
}

/** 길이 정보 노출을 줄이며 상수 시간에 문자열을 비교한다. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * signed httpOnly 쿠키 기반 OAuthCsrfStateStorePort 구현.
 * verify는 성공/실패와 무관하게 쿠키를 즉시 소비해 state 재사용을 차단한다.
 * (다른 저장소가 필요하면 OAuthCsrfStateStorePort를 따로 구현)
 */
export function createCookieStateStore(config: CookieStateStoreConfig): OAuthCsrfStateStorePort {
  if (config.secret.trim() === "") {
    throw new Error("cookie state store secret must not be empty");
  }

  const cookieName = config.cookieName ?? DEFAULT_COOKIE_NAME;
  const maxAge = config.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const baseAttributes: Omit<CookieAttributes, "maxAge"> = {
    httpOnly: true,
    secure: config.secure ?? true,
    sameSite: config.sameSite ?? "Lax",
    path: config.path ?? "/",
  };

  return {
    save(state) {
      config.cookies.set(cookieName, sign(state, config.secret), { ...baseAttributes, maxAge });
    },
    verify(returnedState) {
      const raw = config.cookies.get(cookieName);
      // 성공/실패와 무관하게 즉시 소비한다(만료). 재사용을 원천 차단.
      config.cookies.set(cookieName, "", { ...baseAttributes, maxAge: 0 });
      if (raw === undefined) return false;
      const storedState = unsign(raw, config.secret);
      if (storedState === null) return false;
      return timingSafeEqualStr(storedState, returnedState);
    },
  };
}
