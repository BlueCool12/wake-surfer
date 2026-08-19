/**
 * 환경변수 계약. 누락·형식 오류는 부팅 시점에 즉시 실패한다.
 */
export type AuthApiConfig = {
  readonly port: number;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly githubRedirectUri: string;
  readonly githubScopes: readonly string[];
  readonly cookieSecret: string;
  readonly jwtPrivateKey: string;
  readonly jwtPublicKey: string;
  readonly databaseUrl: string;
  readonly webOrigin: string;
  /** 쿠키에 Secure 속성을 붙일지. 개발 환경(http)에서만 끈다. */
  readonly cookieSecure: boolean;
};

export class AuthApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthApiConfigError";
  }
}

type Source = Readonly<Record<string, string | undefined>>;

function required(source: Source, key: string, missing: string[]): string {
  const value = source[key]?.trim();
  if (!value) {
    missing.push(key);
    return "";
  }
  return value;
}

/**
 * PEM 키를 환경변수로 넘길 때의 개행 복원.
 *
 * dotenv나 컨테이너 환경변수는 여러 줄 값을 그대로 담기 어려워 `\n` 이스케이프로 넣는 관례를 쓴다.
 * 실제 개행이 들어온 경우에도 그대로 통과한다.
 */
function restorePem(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

function assertPem(value: string, key: string, label: string, invalid: string[]): void {
  if (value && !value.includes(label)) {
    invalid.push(`${key} must be a PEM containing "${label}"`);
  }
}

export function loadAuthApiConfig(source: Source = process.env): AuthApiConfig {
  const missing: string[] = [];
  const invalid: string[] = [];

  const githubClientId = required(source, "GITHUB_CLIENT_ID", missing);
  const githubClientSecret = required(source, "GITHUB_CLIENT_SECRET", missing);
  const githubRedirectUri = required(source, "GITHUB_REDIRECT_URI", missing);
  const githubScopesRaw = required(source, "GITHUB_SCOPES", missing);
  const cookieSecret = required(source, "COOKIE_SECRET", missing);
  const jwtPrivateKey = restorePem(required(source, "JWT_PRIVATE_KEY", missing));
  const jwtPublicKey = restorePem(required(source, "JWT_PUBLIC_KEY", missing));
  const databaseUrl = required(source, "DATABASE_URL", missing);
  const webOrigin = required(source, "WEB_ORIGIN", missing);

  if (missing.length > 0) {
    throw new AuthApiConfigError(`missing required environment variables: ${missing.join(", ")}`);
  }

  const portRaw = source.PORT?.trim() ?? "3002";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    invalid.push(`PORT must be an integer between 1 and 65535 (got "${portRaw}")`);
  }

  const scopes = githubScopesRaw
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  if (scopes.length === 0) {
    invalid.push("GITHUB_SCOPES must contain at least one scope");
  }

  try {
    const redirect = new URL(githubRedirectUri);
    if (redirect.protocol !== "http:" && redirect.protocol !== "https:") {
      invalid.push("GITHUB_REDIRECT_URI must use http or https");
    }
  } catch {
    invalid.push(`GITHUB_REDIRECT_URI must be an absolute URL (got "${githubRedirectUri}")`);
  }

  try {
    void new URL(webOrigin);
  } catch {
    invalid.push(`WEB_ORIGIN must be an absolute URL (got "${webOrigin}")`);
  }

  assertPem(jwtPrivateKey, "JWT_PRIVATE_KEY", "PRIVATE KEY", invalid);
  assertPem(jwtPublicKey, "JWT_PUBLIC_KEY", "PUBLIC KEY", invalid);

  // state 쿠키 서명 키가 짧으면 위조 방어가 약해진다.
  if (cookieSecret.length < 32) {
    invalid.push("COOKIE_SECRET must be at least 32 characters");
  }

  if (invalid.length > 0) {
    throw new AuthApiConfigError(`invalid environment variables: ${invalid.join("; ")}`);
  }

  return {
    port,
    githubClientId,
    githubClientSecret,
    githubRedirectUri,
    githubScopes: scopes,
    cookieSecret,
    jwtPrivateKey,
    jwtPublicKey,
    databaseUrl,
    webOrigin,
    cookieSecure: new URL(githubRedirectUri).protocol === "https:",
  };
}
