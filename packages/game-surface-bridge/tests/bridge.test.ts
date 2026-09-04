import { describe, expect, it } from "vitest";

import {
  SURFACE_BRIDGE_VERSION,
  hostHandshakeSchema,
  hostSurfaceMessageSchema,
  surfaceArtifactManifestV1Schema,
  surfaceHostMessageSchema,
} from "../src/index.js";

describe("SurfaceArtifactManifestV1", () => {
  const manifest = {
    schemaVersion: 1,
    gameId: "tic-tac-toe",
    supportedGameVersions: ["1.1.0"],
    surfaceVersion: "1.0.0",
    bridgeVersion: SURFACE_BRIDGE_VERSION,
    entrypoints: { setup: "setup/index.html", play: "play/index.html" },
    capabilities: {},
    contentDigest: `sha256-${"A".repeat(43)}=`,
  } as const;

  it("accepts an immutable, relative artifact description", () => {
    expect(surfaceArtifactManifestV1Schema.parse(manifest)).toEqual(manifest);
  });

  it.each([
    {
      ...manifest,
      entrypoints: { ...manifest.entrypoints, play: "/play.html" },
    },
    { ...manifest, supportedGameVersions: ["1.1.0", "1.1.0"] },
    { ...manifest, bridgeVersion: 2 },
    { ...manifest, ticket: "secret" },
  ])("rejects unsafe or incompatible artifact metadata %#", (candidate) => {
    expect(surfaceArtifactManifestV1Schema.safeParse(candidate).success).toBe(
      false,
    );
  });
});

describe("Game Surface Bridge V1", () => {
  it("uses a nonce-bound handshake", () => {
    const handshake = {
      type: "host.hello",
      bridgeVersion: 1,
      nonce: "n".repeat(32),
      mode: "play",
    } as const;
    expect(hostHandshakeSchema.parse(handshake)).toEqual(handshake);
    expect(
      hostHandshakeSchema.safeParse({ ...handshake, nonce: "short" }).success,
    ).toBe(false);
  });

  it("accepts projected state and minimal intent only", () => {
    expect(
      hostSurfaceMessageSchema.parse({
        type: "host.state",
        sequence: 1,
        connectionState: "connected",
        readOnly: false,
        roundNumber: 1,
        revision: 0,
        payload: { board: [null, null, null] },
        outcome: null,
      }),
    ).toMatchObject({ type: "host.state", revision: 0 });
    expect(
      surfaceHostMessageSchema.parse({
        type: "surface.intent",
        clientIntentId: "intent-1",
        intent: { type: "PLACE_MARK", cell: 4 },
      }),
    ).toMatchObject({ type: "surface.intent" });
  });

  it.each([
    {
      type: "surface.intent",
      clientIntentId: "i",
      intent: {},
      actor: "slot-1",
    },
    {
      type: "surface.intent",
      clientIntentId: "i",
      intent: {},
      ticket: "secret",
    },
    {
      type: "surface.intent",
      clientIntentId: "i",
      intent: { value: undefined },
    },
  ])("rejects forged or non-JSON surface messages %#", (candidate) => {
    expect(surfaceHostMessageSchema.safeParse(candidate).success).toBe(false);
  });
});
