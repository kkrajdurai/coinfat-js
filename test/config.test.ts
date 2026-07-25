/**
 * Environment -> base URL resolution. The API version is pinned by the SDK;
 * merchants only pick an environment, or bypass both with an explicit `apiBase`.
 */

import {describe, expect, it} from "vitest";
import {API_VERSION, resolveConfig} from "../src/core/config.js";

describe("resolveConfig", () => {
  it("defaults to development, the only host that is live", () => {
    // Production is reserved and not deployed. Defaulting to it pointed every
    // caller at a dead host, surfacing as a blank widget.
    expect(resolveConfig()).toEqual({
      environment: "development",
      apiBase: "https://test-api.coinfat.com/api/v1"
    });
  });

  it("maps each environment to its host and pins the API version", () => {
    expect(resolveConfig({environment: "production"}).apiBase).toBe(
      `https://api.coinfat.com/api/${API_VERSION}`
    );
    expect(resolveConfig({environment: "development"}).apiBase).toBe(
      `https://test-api.coinfat.com/api/${API_VERSION}`
    );
  });

  it("lets an explicit apiBase override the environment", () => {
    const config = resolveConfig({
      environment: "production",
      apiBase: "http://localhost:8000/api/v1"
    });

    // `environment` is still reported as asked, but the override wins the URL.
    expect(config).toEqual({
      environment: "production",
      apiBase: "http://localhost:8000/api/v1"
    });
  });

  it("strips trailing slashes so paths never double up", () => {
    // Otherwise `${apiBase}/checkout/${ulid}` yields `//checkout/...`, which some
    // proxies redirect and others 404.
    expect(
      resolveConfig({apiBase: "http://localhost:8000/api/v1/"}).apiBase
    ).toBe("http://localhost:8000/api/v1");
    expect(
      resolveConfig({apiBase: "http://localhost:8000/api/v1///"}).apiBase
    ).toBe("http://localhost:8000/api/v1");
  });
});
