/** Update only the supplied filters without navigation or a new history entry. */
export function replaceQueryParameters(
  values: Readonly<Record<string, string | null>>,
): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
