import attack from "../assets/audio/sword_light.wav?inline";
import clash from "../assets/audio/sword_clash_2.wav?inline";
import jump from "../assets/audio/jump_short.wav?inline";
import wallJump from "../assets/audio/air_burst.wav?inline";
import slide from "../assets/audio/concrete_scrape.wav?inline";
import death from "../assets/audio/crunch_quick.wav?inline";
export const soundPresets = {
  ATTACK: { data: attack, gain: 0.32, duration: 0.3 },
  JUMP: { data: jump, gain: 0.28, duration: 0.3 },
  WALL_JUMP: { data: wallJump, gain: 0.38, duration: 0.3 },
  SLIDE: { data: slide, gain: 0.24, duration: 0.3 },
  CLASH: { data: clash, gain: 1, duration: 0.3 },
  DEATH: { data: death, gain: 0.72, duration: 0.38 },
} as const;
export type SoundKind = keyof typeof soundPresets;
