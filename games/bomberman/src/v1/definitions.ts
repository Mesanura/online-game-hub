/** Game-owned definitions. New arenas and modes do not change the platform. */
export type MapDefinition = {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  readonly walls: readonly number[];
  readonly safeCells: readonly number[];
  readonly brickGroups: readonly (readonly number[])[];
  readonly spawnCycle: readonly number[];
  readonly spawnLayouts: Readonly<Record<number, readonly number[]>>;
  readonly brickPercent: number;
};

export type ModeDefinition = {
  readonly id: string;
  readonly minPlayers: number;
  readonly maxPlayers: number | null;
  readonly targetWins: number;
  readonly prepareTicks: number;
  readonly resultTicks: number;
  readonly roundTicks: number;
  readonly fuseTicks: number;
  readonly flameTicks: number;
  readonly leaseTicks: number;
  readonly lootPercent: number;
  readonly initialCapacity: number;
  readonly maxCapacity: number;
  readonly initialRange: number;
  readonly maxRange: number;
  readonly initialSpeed: number;
  readonly speedIncrement: number;
  readonly maxSpeed: number;
};

export const CELL_SIZE = 1200;
export const PLAYER_HALF_SIZE = 360;
export const TURN_ASSIST = 240;
export const pickupKinds = ["capacity", "range", "speed"] as const;
export type PickupKind = (typeof pickupKinds)[number];

function classicArena(): MapDefinition {
  const cols = 13;
  const rows = 11;
  const walls: number[] = [];
  const safeCells: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cell = y * cols + x;
      if (
        x === 0 ||
        y === 0 ||
        x === cols - 1 ||
        y === rows - 1 ||
        (x % 2 === 0 && y % 2 === 0)
      )
        walls.push(cell);
      else if ((x <= 3 || x >= cols - 4) && (y <= 3 || y >= rows - 4))
        safeCells.push(cell);
    }
  }
  const blocked = new Set([...walls, ...safeCells]);
  const seen = new Set<number>();
  const brickGroups: number[][] = [];
  for (let cell = 0; cell < cols * rows; cell += 1) {
    if (blocked.has(cell) || seen.has(cell)) continue;
    const x = cell % cols;
    const y = Math.floor(cell / cols);
    const group = [
      ...new Set([
        cell,
        y * cols + cols - 1 - x,
        (rows - 1 - y) * cols + x,
        (rows - 1 - y) * cols + cols - 1 - x,
      ]),
    ].sort((a, b) => a - b);
    group.forEach((entry) => seen.add(entry));
    brickGroups.push(group);
  }
  return {
    id: "classic-arena",
    cols,
    rows,
    walls,
    safeCells,
    brickGroups,
    spawnCycle: [
      cols + 1,
      2 * cols - 2,
      (rows - 1) * cols - 2,
      (rows - 2) * cols + 1,
    ],
    spawnLayouts: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
    brickPercent: 70,
  };
}

export const classicMap = classicArena();
export const classicMode: ModeDefinition = {
  id: "classic",
  minPlayers: 2,
  maxPlayers: null,
  targetWins: 3,
  prepareTicks: 180,
  resultTicks: 120,
  roundTicks: 10800,
  fuseTicks: 150,
  flameTicks: 30,
  leaseTicks: 30,
  lootPercent: 30,
  initialCapacity: 1,
  maxCapacity: 5,
  initialRange: 2,
  maxRange: 8,
  initialSpeed: 60,
  speedIncrement: 10,
  maxSpeed: 100,
};

export function supportedPlayerCounts(
  map: MapDefinition,
  mode: ModeDefinition,
): number[] {
  return Object.keys(map.spawnLayouts)
    .map(Number)
    .filter(
      (count) =>
        count >= mode.minPlayers &&
        (mode.maxPlayers === null || count <= mode.maxPlayers),
    )
    .sort((a, b) => a - b);
}

export function spawnCells(
  map: MapDefinition,
  count: number,
  rotation: number,
): number[] {
  const layout = map.spawnLayouts[count];
  if (!layout || layout.length !== count || map.spawnCycle.length < count)
    throw new Error("Unsupported arena capacity.");
  const cells = layout.map((index) => {
    const cell = map.spawnCycle[(index + rotation) % map.spawnCycle.length];
    if (
      cell === undefined ||
      !map.safeCells.includes(cell) ||
      map.walls.includes(cell)
    )
      throw new Error("Invalid arena spawn.");
    return cell;
  });
  if (new Set(cells).size !== count)
    throw new Error("Arena spawns must be distinct.");
  return cells;
}
