interface LiveRoomListing {
  readonly name: string;
  readonly metadata?: unknown;
}

/** Count Colyseus listings, including locked rooms and disconnected reservations. */
export function countLiveRooms(rooms: readonly LiveRoomListing[]) {
  const counts = {
    "turn-based": { v5: 0, v6: 0, unknown: 0 },
    realtime: { v5: 0, v6: 0, unknown: 0 },
  };
  for (const room of rooms) {
    const runtime =
      room.name === "game"
        ? "turn-based"
        : room.name === "realtime-game"
          ? "realtime"
          : null;
    if (runtime === null) continue;
    const metadata = room.metadata;
    const protocol =
      metadata !== null &&
      typeof metadata === "object" &&
      "setupProtocol" in metadata
        ? metadata.setupProtocol
        : undefined;
    const generation =
      protocol === 5 ? "v5" : protocol === 6 ? "v6" : "unknown";
    counts[runtime][generation] += 1;
  }
  return counts;
}
