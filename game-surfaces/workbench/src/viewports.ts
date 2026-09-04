export interface WorkbenchViewport {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const WORKBENCH_VIEWPORTS = Object.freeze([
  {
    id: "desktop-1366",
    label: "Desktop · 1366 × 768",
    width: 1366,
    height: 768,
  },
  {
    id: "desktop-1440",
    label: "Desktop · 1440 × 900",
    width: 1440,
    height: 900,
  },
  {
    id: "desktop-1920",
    label: "Desktop · 1920 × 1080",
    width: 1920,
    height: 1080,
  },
  {
    id: "tablet-landscape",
    label: "Tablet · 1024 × 768",
    width: 1024,
    height: 768,
  },
  {
    id: "tablet-portrait",
    label: "Tablet · 768 × 1024",
    width: 768,
    height: 1024,
  },
  { id: "phone-390", label: "Phone · 390 × 844", width: 390, height: 844 },
  { id: "phone-412", label: "Phone · 412 × 915", width: 412, height: 915 },
  {
    id: "phone-landscape",
    label: "Phone · 844 × 390",
    width: 844,
    height: 390,
  },
] satisfies readonly [WorkbenchViewport, ...WorkbenchViewport[]]);

export function resolveWorkbenchViewport(id: string): WorkbenchViewport {
  return (
    WORKBENCH_VIEWPORTS.find((viewport) => viewport.id === id) ??
    WORKBENCH_VIEWPORTS[0]
  );
}
