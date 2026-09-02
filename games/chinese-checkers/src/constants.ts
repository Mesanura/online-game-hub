import type { ChineseCheckersCamp } from "./types.js";

export const CHINESE_CHECKERS_CELL_COUNT = 73;
export const CHINESE_CHECKERS_BOARD_RADIUS = 3;
export const CHINESE_CHECKERS_CAMP_OPTIONS = [
  "N",
  "NE",
  "SE",
  "S",
  "SW",
  "NW",
] as const satisfies readonly ChineseCheckersCamp[];
export const CHINESE_CHECKERS_COUNTERCLOCKWISE_CAMPS = [
  "N",
  "NW",
  "SW",
  "S",
  "SE",
  "NE",
] as const satisfies readonly ChineseCheckersCamp[];
