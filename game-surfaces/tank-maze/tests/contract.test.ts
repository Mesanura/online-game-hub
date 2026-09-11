import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { surfaceArtifactManifestV1Schema } from "@online-game-hub/game-surface-bridge";
it("provides independently built SVG setup/play artifacts with Bridge V2", () => {
  const config = JSON.parse(
    readFileSync(new URL("../surface.config.json", import.meta.url), "utf8"),
  );
  const lock = JSON.parse(
    readFileSync(new URL("../surface.lock.json", import.meta.url), "utf8"),
  );
  expect(
    surfaceArtifactManifestV1Schema.safeParse({
      ...config,
      contentDigest: lock.contentDigest,
    }).success,
  ).toBe(true);
  for (const mode of ["setup", "play"])
    expect(
      readFileSync(
        new URL("../dist/" + mode + "/index.html", import.meta.url),
        "utf8",
      ),
    ).toContain('type="module"');
  expect(config.entrypoints.replay).toBeUndefined();
  expect(config.surfaceVersion).toBe("1.1.2");
  expect(config.supportedGameVersions).toEqual(["1.0.0", "1.1.0"]);
});
