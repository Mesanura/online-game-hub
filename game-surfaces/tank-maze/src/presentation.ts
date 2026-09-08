import type { View } from "./contracts";

type HitView = Pick<
  View,
  "tick" | "bout" | "phase" | "elapsed" | "tanks" | "events"
>;

export function hasNewHit(
  previous: HitView | null,
  next: HitView,
  lastEvent: number,
) {
  if (previous === null || next.tick < previous.tick) return false;
  if (next.events.some((event) => event.id > lastEvent && event.kind === "hit"))
    return true;
  // An unscored new bout before the timeout means the last survivors were hit.
  if (next.bout === previous.bout + 1 && next.phase === "PREPARE") {
    return (
      (previous.phase === "LAST" ||
        (previous.phase === "ACTIVE" &&
          previous.elapsed + next.tick - previous.tick < 7200)) &&
      previous.tanks.some((tank) => tank.alive && !tank.resigned) &&
      next.tanks.every((tank) =>
        previous.tanks.some(
          (old) => old.slotId === tank.slotId && old.score === tank.score,
        ),
      )
    );
  }
  // A snapshot may skip the tick that carried the transient hit event.
  return (
    previous.bout === next.bout &&
    next.tanks.some(
      (tank) =>
        !tank.alive &&
        !tank.resigned &&
        previous.tanks.some((old) => old.slotId === tank.slotId && old.alive),
    )
  );
}

export function pickupSymbol(kind: View["pickups"][number]["kind"]) {
  const shapes = {
    laser:
      '<path d="M-12 0H12M-8 -7V7M8 -7V7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    missile: '<path d="M-11 -9L11 0L-11 9L-6 0Z" fill="currentColor"/>',
    machine:
      '<g fill="currentColor"><circle cy="-8" r="2.5"/><circle r="2.5"/><circle cy="8" r="2.5"/></g>',
    shotgun:
      '<g fill="currentColor"><circle cx="-8" cy="-8" r="2.5"/><circle cx="8" cy="-8" r="2.5"/><circle r="2.5"/><circle cx="-8" cy="8" r="2.5"/><circle cx="8" cy="8" r="2.5"/></g>',
    shield:
      '<path d="M0 -12L10 -8V0Q10 7 0 12Q-10 7 -10 0V-8Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>',
  };
  return (
    '<g data-pickup-symbol="' +
    kind +
    '" color="#3c4940">' +
    shapes[kind] +
    "</g>"
  );
}
