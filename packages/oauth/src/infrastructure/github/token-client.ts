import { assertValidOAuthConfig, type OAuthConfig } from "../../domain/oauth-config";
import {
  sanitizeProviderErrorCode,
  sanitizeProviderErrorDescription,
  type OAuthProviderError,
} from "../../domain/oauth-provider-error";

import { GITHUB_TOKEN_URL } from "./endpoints";
import type { GithubRequestExecutor } from "./request-executor";

export type ExchangeCodeResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly providerError?: OAuthProviderError };

export type GithubTokenClient = {
  /** authorization code를 GitHub access token으로 교환한다. */
  exchangeCode: (code: string) => Promise<ExchangeCodeResult>;
};

/**
 * GitHub은 잘못된 code에도 HTTP 200 + body의 error로 응답하므로,
 * 상태코드가 아니라 body의 access_token/error 유무로 판정한다.
 */
export function createGithubTokenClient(
  config: OAuthConfig,
  executor: GithubRequestExecutor,
): GithubTokenClient {
  return {
    async exchangeCode(code) {
      assertValidOAuthConfig(config);
      if (code.trim() === "") {
        throw new Error("code must not be empty");
      }

      const response = await executor.executeJson({
        url: GITHUB_TOKEN_URL,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
        }),
      });

      if (!response.ok || typeof response.body !== "object" || response.body === null) {
        return { ok: false };
      }

      const record = response.body as Record<string, unknown>;
      const accessToken = record["access_token"];
      if (typeof accessToken === "string" && accessToken !== "") {
        return { ok: true, accessToken };
      }

      const error = sanitizeProviderErrorCode(record["error"]);
      const errorDescription = sanitizeProviderErrorDescription(record["error_description"]);
      return {
        ok: false,
        ...(error !== undefined
          ? {
              providerError: {
                error,
                ...(errorDescription !== undefined ? { errorDescription } : {}),
              },
            }
          : {}),
      };
    },
  };
}
