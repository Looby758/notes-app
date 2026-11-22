/**
 * Screen snip, more than one monitor: which screen picture belongs to which monitor.
 *
 * Electron names each picture's monitor (`display_id`), but on some Windows and Linux setups that
 * name is empty. Then the pictures come in the same order as the monitors, so they're matched by
 * position (only when the counts agree, so a wrong picture is never put on a monitor).
 */
export function matchSources<S extends { display_id: string }>(
  displayIds: number[],
  sources: S[],
): Map<number, S> {
  const out = new Map<number, S>();
  const used = new Set<S>();
  for (const id of displayIds) {
    const s = sources.find((x) => x.display_id && x.display_id === String(id));
    if (s) {
      out.set(id, s);
      used.add(s);
    }
  }
  if (out.size === displayIds.length) return out;
  const unnamed = sources.filter((s) => !used.has(s) && !s.display_id);
  const missing = displayIds.filter((id) => !out.has(id));
  if (
    sources.length === displayIds.length &&
    unnamed.length === missing.length
  ) {
    // Pictures without a name, in monitor order.
    const order = sources.filter((s) => !s.display_id);
    missing.forEach((id, i) => out.set(id, order[i]));
  } else if (displayIds.length === 1 && sources.length) {
    out.set(displayIds[0], sources[0]);
  }
  return out;
}
