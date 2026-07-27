/**
 * Environment -> backend base URL. The API version is pinned by the SDK; merchants
 * only pick an environment, or bypass both with an explicit `apiBase`.
 */

export type Environment = "production" | "development";

/**
 * No trailing slash, no `/api/v1` suffix — `resolveConfig` adds it. Production is
 * reserved: the host is not deployed yet, development is the live one. Spelled out
 * rather than composed from `BRAND` (see `brand.ts`).
 */
const BASE_URLS: Record<Environment, string> = {
  production: "https://api.coinfat.com",
  development: "https://test-api.coinfat.com"
};

/** The API version this SDK is built against. */
export const API_VERSION = "v1";

export interface ResolvedConfig {
  environment: Environment;
  /** Fully-qualified base for checkout calls, e.g. "https://api.coinfat.com/api/v1". */
  apiBase: string;
}

export interface CoinfatOptions {
  /** Defaults to 'development', the only live host — flip once production deploys. */
  environment?: Environment;
  /**
   * Escape hatch for a custom backend (local dev, staging). Overrides
   * `environment` and must already include the `/api/v1` path.
   */
  apiBase?: string;
}

export function resolveConfig(options: CoinfatOptions = {}): ResolvedConfig {
  const environment: Environment = options.environment ?? "development";

  // Strip trailing slashes so a supplied apiBase never yields `//checkout/...`.
  const apiBase = (
    options.apiBase ?? `${BASE_URLS[environment]}/api/${API_VERSION}`
  ).replace(/\/+$/, "");

  return {environment, apiBase};
}
