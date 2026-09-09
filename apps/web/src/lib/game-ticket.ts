import {
  gameServerTicketSchema,
  PROTOCOL_VERSION,
  type SetupProtocolGeneration,
} from "@online-game-hub/protocol";

import {
  DEFAULT_DISPLAY_NAME,
  GUEST_PROFILE_STORAGE_KEY,
  readStoredGuestDisplayName,
} from "./profile";

/** The Web owns browser profiles; both client runtimes receive an opaque ticket. */
export async function requestGameTicket(
  protocolVersion: SetupProtocolGeneration = PROTOCOL_VERSION,
): Promise<string> {
  let displayName = DEFAULT_DISPLAY_NAME;
  try {
    displayName = readStoredGuestDisplayName(
      window.localStorage.getItem(GUEST_PROFILE_STORAGE_KEY),
    );
  } catch {
    // Private browsing or blocked storage still permits joining as a guest.
  }
  const response = await fetch("/api/game-ticket", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion, displayName }),
  });
  if (!response.ok) throw new Error("Game Server ticket is unavailable.");
  const payload: unknown = await response.json();
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !("ticket" in payload)
  ) {
    throw new Error("Invalid Game Server ticket response.");
  }
  return gameServerTicketSchema.parse(payload.ticket);
}
