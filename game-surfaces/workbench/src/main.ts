import "./styles.css";

import {
  SurfaceBridgeHost,
  SURFACE_BRIDGE_V2,
  createSurfaceSandbox,
  type SurfaceBridgeHostStatus,
} from "@online-game-hub/game-surface-bridge";

import { WORKBENCH_FIXTURES, resolveWorkbenchFixture } from "./fixtures";
import {
  advanceWorkbenchSimulation,
  createWorkbenchSimulation,
  createWorkbenchStateMessage,
  updateWorkbenchSimulation,
  type WorkbenchConnectionState,
  type WorkbenchSimulation,
} from "./simulator";
import { WORKBENCH_VIEWPORTS, resolveWorkbenchViewport } from "./viewports";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null)
    throw new Error(`Missing Workbench element: ${selector}`);
  return element;
}

const form = requireElement<HTMLFormElement>("#surface-form");
const urlInput = requireElement<HTMLInputElement>("#surface-url");
const fixtureSelect = requireElement<HTMLSelectElement>("#fixture");
const connectionSelect = requireElement<HTMLSelectElement>("#connection-state");
const viewportSelect = requireElement<HTMLSelectElement>("#viewport");
const intentResultSelect = requireElement<HTMLSelectElement>("#intent-result");
const readOnlyInput = requireElement<HTMLInputElement>("#read-only");
const terminalInput = requireElement<HTMLInputElement>("#terminal");
const reducedMotionInput = requireElement<HTMLInputElement>("#reduced-motion");
const bridgeStatus = requireElement<HTMLElement>("#bridge-status");
const previewShell = requireElement<HTMLElement>("#preview-shell");
const emptyPreview = requireElement<HTMLElement>("#empty-preview");
const eventLog = requireElement<HTMLOListElement>("#event-log");

let simulation: WorkbenchSimulation = createWorkbenchSimulation(
  WORKBENCH_FIXTURES[0],
);
let bridge: SurfaceBridgeHost | null = null;
let frame: HTMLIFrameElement | null = null;
let sequence = 0;
let focusMode = false;

function logEvent(label: string, detail?: unknown): void {
  const entry = document.createElement("li");
  const time = new Date().toLocaleTimeString();
  entry.textContent =
    detail === undefined
      ? `${time} · ${label}`
      : `${time} · ${label} · ${JSON.stringify(detail)}`;
  eventLog.prepend(entry);
}

function renderStatus(status: SurfaceBridgeHostStatus): void {
  bridgeStatus.dataset.state = status.state;
  bridgeStatus.textContent =
    status.state === "failed"
      ? `失败 · ${status.code}`
      : status.state === "loading"
        ? `握手中 · #${status.attempt}`
        : status.state === "ready"
          ? "Bridge ready"
          : status.state === "disposed"
            ? "已关闭"
            : "未加载";
  logEvent("Host status", status);
}

function renderSimulationControls(): void {
  fixtureSelect.value = simulation.fixture.id;
  connectionSelect.value = simulation.connectionState;
  readOnlyInput.checked = simulation.readOnly || simulation.terminal;
  readOnlyInput.disabled = simulation.fixture.readOnly || simulation.terminal;
  terminalInput.checked = simulation.terminal;
  reducedMotionInput.checked = simulation.reducedMotion;
}

function sendState(): void {
  if (bridge === null) return;
  const nextSequence = sequence + 1;
  if (bridge.send(createWorkbenchStateMessage(simulation, nextSequence))) {
    sequence = nextSequence;
    logEvent("host.state", {
      sequence,
      fixture: simulation.fixture.id,
      counter: simulation.counter,
      terminal: simulation.terminal,
    });
  }
}

function sendEnvironment(): void {
  if (bridge === null) return;
  const viewport = resolveWorkbenchViewport(viewportSelect.value);
  const fullscreen =
    focusMode ||
    (document.fullscreenElement !== null &&
      document.fullscreenElement.contains(previewShell));
  bridge.send({
    type: "host.environment",
    width: fullscreen ? window.innerWidth : viewport.width,
    height: fullscreen ? window.innerHeight : viewport.height,
    fullscreen,
  });
}

function applyViewport(): void {
  const viewport = resolveWorkbenchViewport(viewportSelect.value);
  previewShell.style.width = `${viewport.width}px`;
  previewShell.style.height = `${viewport.height}px`;
  sendEnvironment();
}

function disposeSurface(): void {
  bridge?.dispose();
  bridge = null;
  frame?.remove();
  frame = null;
  sequence = 0;
}

function loadSurface(): void {
  const url = new URL(urlInput.value, window.location.href);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Surface URL must use HTTP or HTTPS.");
  }
  disposeSurface();
  emptyPreview.hidden = true;

  const nextFrame = document.createElement("iframe");
  nextFrame.className = "surface-frame";
  nextFrame.referrerPolicy = "no-referrer";
  nextFrame.sandbox.value = createSurfaceSandbox(true);
  nextFrame.title = `${simulation.fixture.label} Surface`;
  const host = new SurfaceBridgeHost({
    bridgeVersion: SURFACE_BRIDGE_V2,
    frameWindow: () => nextFrame.contentWindow,
    mode: simulation.fixture.mode,
    init: {
      gameId: simulation.fixture.gameId,
      gameVersion: simulation.fixture.gameVersion,
      locale: navigator.language || "zh-CN",
      reducedMotion: simulation.reducedMotion,
    },
    onIntent: (message) => {
      logEvent("surface.intent", {
        clientIntentId: message.clientIntentId,
        intent: message.intent,
      });
      const status = simulation.readOnly
        ? "rejected"
        : (intentResultSelect.value as "accepted" | "rejected" | "stale");
      host.send({
        type: "host.intent-result",
        clientIntentId: message.clientIntentId,
        status,
        ...(status === "accepted"
          ? {}
          : {
              code: simulation.readOnly
                ? "WORKBENCH_READ_ONLY"
                : `WORKBENCH_${status.toUpperCase()}`,
            }),
      });
      if (status === "accepted") {
        simulation = advanceWorkbenchSimulation(simulation);
        renderSimulationControls();
        sendState();
      }
    },
    onSurfaceError: (message) => {
      logEvent("surface.error", {
        code: message.code,
        message: message.message,
      });
      host.reportSurfaceCrash();
    },
    onDiagnostic: (message) => logEvent("surface.diagnostic", message),
    onResultSummary: (message) =>
      logEvent("surface.result-summary", {
        stateSequence: message.stateSequence,
        tone: message.tone,
        headline: message.headline,
        details: message.details,
      }),
    onStatusChange: (status) => {
      renderStatus(status);
      if (status.state === "ready") {
        sendState();
        sendEnvironment();
      }
    },
  });
  bridge = host;
  nextFrame.addEventListener("load", () => host.start(), { once: true });
  nextFrame.addEventListener("error", () => host.reportSurfaceCrash(), {
    once: true,
  });
  nextFrame.src = url.href;
  previewShell.append(nextFrame);
  frame = nextFrame;
}

for (const fixture of WORKBENCH_FIXTURES) {
  fixtureSelect.add(new Option(fixture.label, fixture.id));
}
for (const viewport of WORKBENCH_VIEWPORTS) {
  viewportSelect.add(new Option(viewport.label, viewport.id));
}
viewportSelect.value = "desktop-1366";
renderSimulationControls();
applyViewport();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    loadSurface();
  } catch (error) {
    renderStatus({ state: "failed", attempt: 0, code: "FRAME_UNAVAILABLE" });
    logEvent("Load rejected", error instanceof Error ? error.message : error);
  }
});

fixtureSelect.addEventListener("change", () => {
  const reducedMotion = simulation.reducedMotion;
  simulation = updateWorkbenchSimulation(
    createWorkbenchSimulation(resolveWorkbenchFixture(fixtureSelect.value)),
    { reducedMotion },
  );
  renderSimulationControls();
  if (urlInput.value.length > 0) loadSurface();
});

connectionSelect.addEventListener("change", () => {
  simulation = updateWorkbenchSimulation(simulation, {
    connectionState: connectionSelect.value as WorkbenchConnectionState,
  });
  sendState();
});

readOnlyInput.addEventListener("change", () => {
  simulation = updateWorkbenchSimulation(simulation, {
    readOnly: readOnlyInput.checked,
  });
  renderSimulationControls();
  sendState();
});

terminalInput.addEventListener("change", () => {
  simulation = updateWorkbenchSimulation(simulation, {
    terminal: terminalInput.checked,
  });
  renderSimulationControls();
  sendState();
});

reducedMotionInput.addEventListener("change", () => {
  simulation = updateWorkbenchSimulation(simulation, {
    reducedMotion: reducedMotionInput.checked,
  });
  if (urlInput.value.length > 0) loadSurface();
});

viewportSelect.addEventListener("change", applyViewport);

requireElement<HTMLButtonElement>("#advance").addEventListener("click", () => {
  simulation = advanceWorkbenchSimulation(simulation);
  renderSimulationControls();
  sendState();
});

requireElement<HTMLButtonElement>("#send-state").addEventListener(
  "click",
  sendState,
);

requireElement<HTMLButtonElement>("#clear-log").addEventListener(
  "click",
  () => {
    eventLog.replaceChildren();
  },
);

requireElement<HTMLButtonElement>("#toggle-fullscreen").addEventListener(
  "click",
  async () => {
    if (document.fullscreenElement === previewShell) {
      await document.exitFullscreen();
      return;
    }
    if (focusMode) {
      focusMode = false;
      previewShell.classList.remove("is-focus-mode");
      previewShell.dataset.focusMode = "false";
      applyViewport();
      return;
    }
    try {
      await previewShell.requestFullscreen();
    } catch {
      focusMode = true;
      previewShell.classList.add("is-focus-mode");
      previewShell.dataset.focusMode = "true";
      sendEnvironment();
    }
  },
);

document.addEventListener("fullscreenchange", sendEnvironment);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && focusMode) {
    focusMode = false;
    previewShell.classList.remove("is-focus-mode");
    previewShell.dataset.focusMode = "false";
    applyViewport();
  }
});
window.addEventListener("beforeunload", disposeSurface, { once: true });
