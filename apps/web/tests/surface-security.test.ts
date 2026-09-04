import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("Surface static security", () => {
  it("serves immutable CORS assets under a network-denying CSP", async () => {
    const headers = await nextConfig.headers?.();
    const surface = headers?.find(
      (entry) => entry.source === "/game-surfaces/:path*",
    );
    const values = new Map(
      surface?.headers.map((header) => [header.key, header.value]),
    );

    expect(values.get("Cache-Control")).toContain("immutable");
    expect(values.get("Access-Control-Allow-Origin")).toBe("*");
    expect(values.get("Content-Security-Policy")).toContain(
      "connect-src 'none'",
    );
    expect(values.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'self'",
    );
  });

  it("keeps Surface artifacts outside guest-session proxy processing", () => {
    const source = readFileSync(
      new URL("../src/proxy.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("favicon.ico|game-surfaces/");
  });
});
